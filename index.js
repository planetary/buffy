'use strict';

const bluebird = require('bluebird');
const Botkit = require('botkit');
const moment = require('moment');
const botkitRedisStorage = require('botkit-storage-redis');
const schedule = require('node-schedule');
const Trello = require('node-trello');

require('dotenv').load();
const debug = process.env.DEBUG === 'true';

if(!process.env.SLACK_BOT_TOKEN)
    throw new Error('Specify token in environment');

const t = new Trello(process.env.TRELLO_KEY, process.env.TRELLO_SECRET);
bluebird.promisifyAll(t);

const redisStorage = botkitRedisStorage({
    url: process.env.REDIS_URL
});

const controller = Botkit.slackbot({
    debug: debug,
    storage: redisStorage
});
bluebird.promisifyAll(controller.storage.users);

const bot = controller.spawn({
    token: process.env.SLACK_BOT_TOKEN
}).startRTM();

const checkUserTrello = () => {
    bot.api.users.list({}, (err, res) => {
        if(err || !res.ok) {
            console.error(`Couldn't retrieve user list!`, err);
        }

        let teammates = [];
        res.members.forEach((user) => {
            if(!user.is_bot &&
                !user.is_restricted &&
                !user.ultra_restricted &&
                !user.deleted &&
                user.name !== 'slackbot' /* is_bot === false for slackbot. really? */) {
                teammates.push(user);
            }
        });

        if(debug) {
            teammates = [
                {
                    id: 'U02ESHJRL',
                    name: 'josh'
                }
            ];
        }

        teammates.forEach((user) => {
            controller.storage.users.get(user.id, (err, data) => {
                if(err)
                    console.log(`Could not find user data for ${user.id} because:\n`, err);

                if(data && data.trello)
                    return;

                console.log(`No trello data for ${user.name}`);

                bot.startPrivateConversation({
                    user: user.id
                }, (err, convo) => {
                    if(err) {
                        console.error(
                            `Couldn't send a Trello username request to ${user.name} because:\n`,
                            err
                        );
                        return;
                    }

                    const checkUsername = (question) => {
                        convo.ask(
                            question || `Hey, real quick: what's your Trello username?`,
                            [
                                {
                                    pattern: new RegExp(
                                        '(^u[mh]+)|(hold on)|((one|a) sec(ond)?)|' +
                                        '(\\bwait\\b)|(^ok)|(got it)|(^no|nope$)'
                                    ),
                                    callback: (response, convo) => {
                                        convo.silentRepeat();
                                    }
                                },
                                {
                                    default: true,
                                    callback: (response, convo) => {
                                        convo.say(`Hold on, let me check that...`);
                                        convo.next();

                                        t.getAsync('/1/members/' + response.text + '/cards')
                                        .then(() => {
                                            convo.say('Great, thanks!');
                                            controller.storage.users.save({
                                                id: user.id,
                                                trello: response.text
                                            });
                                            convo.next();
                                        })
                                        .catch(() => {
                                            convo.next();
                                            checkUsername(
                                                `Hmm...I couldn't find that user. ` +
                                                `Could you check again?`
                                            );
                                        });
                                    }
                                }
                            ]
                        );
                    };

                    checkUsername();
                });
            });
        });
    });
};

const lateTasks = (userId) => {
    let _boards = {};

    t.getAsync('/1/members/me/boards')
    .then((boards) => {
        let boardProps = {};
        boards.forEach((board) => {
            boardProps[board.id] = {
                name: board.name,
                lists: {}
            };
        });

        return bluebird
        .map(boards, (board) => {
            return t.getAsync('/1/board/' + board.id + '/lists');
        })
        .then((lists) => {
            lists.forEach((group, index) => {
                group.forEach((list) => boardProps[boards[index].id].lists[list.id] = list.name);
            });

            _boards = boardProps;

            if(userId)
                return controller.storage.users.getAsync(userId)
                    .then((user) => [user]); // to keep the out format like the `all` call below

            return controller.storage.users.allAsync();
        });
    })
    .then((users) => {
        return users.map((user) => {
            if(!user.trello)
                return;

            return t
                .getAsync('/1/members/' + user.trello + '/cards')
                .then((cards) => ({
                    user: user,
                    cards: cards
                }));
        });
    })
    .each((data) => {
        let out = {};
        let lateCards = 0;
        Object.keys(_boards).forEach((board) => out[board] = []);
        data.cards.forEach((card) => {
            const list = _boards[card.idBoard].lists[card.idList].toLowerCase();
            const due = moment(card.badges.due);

            if(due.isBefore(new Date()) && !list.match(/completed|done|shipped/)) {
                lateCards++;
                out[card.idBoard].push(
                    `${due.format('MMM D, YYYY @ h:mma')}: <${card.shortUrl}|${card.name}>`
                );
            }
        });

        if(!lateCards)
            return;

        const tasks = [];
        Object.keys(out).forEach((board) => {
            if(!out[board].length)
                return;

            tasks.push({
                fallback: `${_boards[board].name}: ${out[board].length} tasks`,
                title: _boards[board].name,
                text: out[board].join('\n'),
                color: '#838C91'
            });
        });

        bot.startPrivateConversation({
            user: data.user.id
        }, (err, convo) => {
            if(err) {
                console.error(
                    `Could not start conversation with user ${data.user.id} because:\n${err}`
                );
                return;
            }

            convo.say({
                text:
                    `Hey! A few of your tasks are recently past due. Could you go through ` +
                    `and add comments or update the expected completion dates?\n\n`,
                attachments: tasks
            });
        });
    })
    .catch((err) => console.trace(err));
};

schedule.scheduleJob('0 30 9 * * 1', checkUserTrello);
schedule.scheduleJob('0 30 10 * * 1', lateTasks);

controller.hears('late', ['direct_message'], (bot, message) => lateTasks(message.user));
controller.hears('^announce$', ['direct_message'], () => lateTasks());
controller.hears('^check users$', ['direct_message'], checkUserTrello);

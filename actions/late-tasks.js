'use strict';

const async = require('async');
const bluebird = require('bluebird');
const moment = require('moment');
const schedule = require('node-schedule');
const TrelloAPI = require('node-trello');

const trello = new TrelloAPI(process.env.TRELLO_KEY, process.env.TRELLO_SECRET);
bluebird.promisifyAll(trello);

const debug = process.env.DEBUG === 'true';

const lateTasks = (bot, controller, userId) => {
    let _boards = {};

    const q = async.queue((task, done) => {
        bot.startPrivateConversation({
            user: task.user.id
        }, (err, convo) => {
            if(err) {
                console.error(
                    `Could not start conversation with user ${task.user.id} because:\n${err}`
                );
                return;
            }

            if(task.lateCards) {
                const tasks = [];
                Object.keys(task.out).forEach((board) => {
                    if(!task.out[board].length)
                        return;

                    tasks.push({
                        fallback: `${_boards[board].name}: ${task.out[board].length} tasks`,
                        title: _boards[board].name,
                        text: task.out[board].join('\n'),
                        color: '#838C91'
                    });
                });

                convo.say({
                    text:
                        `Hey! A few of your tasks are recently past due. Could you go through ` +
                        `and add comments or update the expected completion dates?\n\n`,
                    attachments: tasks
                });
            } else if(userId) {
                convo.say(`You don't have any late tasks right now!`);
            }
        });

        setTimeout(done, 1100); // wait 1.1s before allowing the next task to run (rate limit = 1s)
    });

    trello.getAsync('/1/members/me/boards')
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
            return trello.getAsync('/1/board/' + board.id + '/lists');
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
        if(debug) {
            const ids = process.env.DEBUG_USER_ID.split(',');
            users = users.filter((user) => ids.indexOf(user.id) > -1);
        }

        return users.map((user) => {
            if(!user.trello)
                return;

            return trello
                .getAsync('/1/members/' + user.trello + '/cards')
                .then((cards) => ({
                    user: user,
                    cards: cards
                }));
        });
    })
    .each((data) => {
        data.out = {};
        data.lateCards = 0;
        Object.keys(_boards).forEach((board) => data.out[board] = []);
        data.cards.forEach((card) => {
            if(!_boards[card.idBoard])
                return;

            const list = _boards[card.idBoard].lists[card.idList].toLowerCase();
            const due = moment(card.badges.due);

            if(due.isBefore(new Date()) &&
                !list.match(/completed|done|shipped|(ready for qa)|(ready to ship)/)) {
                data.lateCards++;
                data.out[card.idBoard].push(
                    `${due.format('MMM D, YYYY @ h:mma')}: <${card.shortUrl}|${card.name}>`
                );
            }
        });

        q.push(data);
    })
    .catch((err) => console.trace(err));
};

module.exports = (bot, controller) => {
    schedule.scheduleJob('0 30 10 * * *', () => lateTasks(bot, controller));

    controller.hears(
        'late',
        ['direct_message'],
        (bot, message) => lateTasks(bot, controller, message.user)
    );
    controller.hears('^announce$', ['direct_message'], () => lateTasks(bot, controller));
};

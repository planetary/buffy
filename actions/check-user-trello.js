'use strict';

const bluebird = require('bluebird');
const schedule = require('node-schedule');
const TrelloAPI = require('node-trello');

const trello = new TrelloAPI(process.env.TRELLO_KEY, process.env.TRELLO_SECRET);
bluebird.promisifyAll(trello);

const debug = process.env.DEBUG === 'true';

const checkUsername = (controller, user, convo, question) => {
    convo.ask(
        question || `Hey, real quick: what's your Trello username?`,
        [
            {
                pattern: new RegExp(
                    '^((u[mh]+)|(hold on)|((one|a) sec(ond)?)|' +
                    '(\\bwait\\b)|(^ok)|(got it)|(no|nope))$'
                ),
                callback: (response, convo) => {
                    convo.silentRepeat();
                }
            },
            {
                default: true,
                callback: (response, convo) => {
                    convo.say(`Hold on, let me check that...`);

                    trello.getAsync('/1/members/' + response.text + '/cards')
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
                            controller,
                            user,
                            convo,
                            `Hmm...I couldn't find that user. ` +
                            `Could you check again?`
                        );
                    });
                }
            }
        ]
    );
};

const checkUserTrello = (bot, controller) => {
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
            const usernames = process.env.DEBUG_USER.split(',');
            teammates = teammates.filter((user) => usernames.indexOf(user.name) > -1);
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
                            `Couldn't send a Trello username ` +
                            `request to ${user.name} because:\n`,
                            err
                        );
                        return;
                    }

                    checkUsername(controller, user, convo);
                });
            });
        });
    });
};

module.exports = (bot, controller) => {
    const check = () => checkUserTrello(bot, controller);

    schedule.scheduleJob('0 30 9 * * 1', check);
    controller.hears('^check users$', ['direct_message'], check);
};

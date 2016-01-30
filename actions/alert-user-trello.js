'use strict';

const bluebird = require('bluebird');
const bodyParser = require('body-parser');
const express = require('express');
const TrelloAPI = require('node-trello');

const trello = new TrelloAPI(process.env.TRELLO_KEY, process.env.TRELLO_SECRET);
bluebird.promisifyAll(trello);

module.exports = (bot, controller) => {
    const app = express();
    app.use(bodyParser.json());

    app.post('/trello/webhook', function(req, res) {
        if(!req.body.action || typeof req.body.action !== 'object')
            return;

        const action = req.body.action;
        const model = req.body.model;

        if(action.type !== 'commentCard')
            return;

        controller.storage.users.all((err, users) => {
            if(err)
                return console.error(`Couldn't retrieve users because:\n`, err);

            const user = users.filter((u) => u.trello === model.username);
            if(!user.length || model.username === action.memberCreator.username)
                return;

            bot.startPrivateConversation({
                user: user[0].id
            }, (err, convo) => {
                if(err) {
                    return console.error(
                        `Couldn't send a Trello username ` +
                        `request to ${user[0].id} because:\n`,
                        err
                    );
                }

                convo.say({
                    text:
                        `*${action.memberCreator.username}* ` +
                        `<https://trello.com/c/${action.data.card.shortLink}|commented>`,
                    attachments: [
                        {
                            'fallback':
                                `*${action.memberCreator.username}* commented: ` +
                                `https://trello.com/c/${action.data.card.shortLink}`,
                            'text': action.data.text,
                            'fields': [
                                {
                                    'title': 'Card',
                                    'value': action.data.card.name,
                                    'short': true
                                },
                                {
                                    'title': 'Board',
                                    'value': action.data.board.name,
                                    'short': true
                                }
                            ],
                            'color': '#838C91'
                        }
                    ]
                });
            });
        });

        res.send('ok');
    });

    app.get('/trello/webhook', function(req, res) {
        res.send('ok');
    });

    app.listen(
        process.env.PORT,
        () => console.log(`Trello Webhook server listening on ${process.env.PORT}`)
    );

    controller.hears('^notifications on$', ['direct_message'], (bot, message) => {
        controller.storage.users.get(message.user, (err, data) => {
            if(err)
                console.log(`Could not find user data for ${message.user} because:\n`, err);

            trello
            .getAsync('/1/members/' + data.trello)
            .then((res) => {
                return trello.putAsync(
                    '/1/webhooks',
                    {
                        callbackURL: `http://${process.env.HOSTNAME}/trello/webhook`,
                        idModel: res.id
                    }
                );
            })
            .then((res) => {
                controller.storage.users.save({
                    id: message.user,
                    trelloWebhook: res.id,
                    trello: data.trello
                });
                bot.reply(message, `Trello notifications have been turned *on*.`);
            })
            .catch((err) => console.trace(`Error creating webhook:\n`, err));
        });
    });

    controller.hears('^notifications off$', ['direct_message'], (bot, message) => {
        controller.storage.users.get(message.user, (err, data) => {
            if(err)
                console.log(`Could not find user data for ${message.user} because:\n`, err);

            trello
            .delAsync('/1/webhooks/' + data.trelloWebhook)
            .then(() => bot.reply(message, `Trello notifications have been turned *off*.`))
            .catch((err) => console.trace(err));
        });
    });
};

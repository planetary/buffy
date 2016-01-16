'use strict';

const bluebird = require('bluebird');
const Botkit = require('botkit');
const botkitRedisStorage = require('botkit-storage-redis');
const fs = require('fs');
const path = require('path');

require('dotenv').load();

if(!process.env.SLACK_BOT_TOKEN)
    throw new Error('Specify token in environment');

const debug = process.env.DEBUG === 'true';

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

const normalizedPath = path.join(__dirname, 'actions');

fs.readdirSync(normalizedPath).forEach(function(file) {
    require(path.join(normalizedPath, file))(bot, controller);
});

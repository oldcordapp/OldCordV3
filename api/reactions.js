const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const { channelPermissionsMiddleware, rateLimitMiddleware } = require('../helpers/middlewares');

const router = express.Router({ mergeParams: false });

router.param('userid', async (req, res, next, userid) => {
    req.user = await global.database.getAccountByUserId(userid);

    next();
});

router.delete("/:urlencoded/@me", channelPermissionsMiddleware("ADD_REACTIONS"), rateLimitMiddleware(global.config.ratelimit_config.removeReaction.maxPerTimeFrame, global.config.ratelimit_config.removeReaction.timeFrame), async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let channel = req.channel;

        if (!channel) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let guild = req.guild;

        if (channel.type != 1 && channel.type != 3 && !guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let message = req.message;

        if (!message) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Message"
            });
        }

        if (guild && guild.exclusions.includes("reactions")) {
            return res.status(400).json({
                code: 400,
                message: "Reactions are disabled in this server due to its maximum support"
            });
        }

        let encoded = req.params.urlencoded;
        let dispatch_name = decodeURIComponent(encoded);
        let id = null;

        if (encoded.includes(":")) {
            id = encoded.split(':')[1];
            encoded = encoded.split(':')[0];
            dispatch_name = encoded;
        }

        let tryUnReact = await global.database.removeMessageReaction(message, account.id, id, dispatch_name);

        if (!tryUnReact) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }
        
        const payload = {
            channel_id: channel.id,
            message_id: message.id,
            user_id: account.id,
            emoji: {
                id: id,
                name: dispatch_name
            }
        };

        if (guild)
            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "MESSAGE_REACTION_REMOVE", payload);
        else
            await global.dispatcher.dispatchEventInPrivateChannel(channel.id, "MESSAGE_REACTION_REMOVE", payload);

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.delete("/:urlencoded/:userid", channelPermissionsMiddleware("MANAGE_MESSAGES"), rateLimitMiddleware(global.config.ratelimit_config.removeReaction.maxPerTimeFrame, global.config.ratelimit_config.removeReaction.timeFrame), async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let user = req.user;

        if (!user) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let channel = req.channel;

        if (!channel) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let guild = req.guild;

        if (channel.type != 1 && channel.type != 3 && !guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let message = req.message;

        if (!message) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Message"
            });
        }

        if (guild && guild.exclusions.includes("reactions")) {
            return res.status(400).json({
                code: 400,
                message: "Reactions are disabled in this server due to its maximum support"
            });
        }

        let encoded = req.params.urlencoded;
        let dispatch_name = decodeURIComponent(encoded);
        let id = null;

        if (encoded.includes(":")) {
            id = encoded.split(':')[1];
            encoded = encoded.split(':')[0];
            dispatch_name = encoded;
        }

        let tryUnReact = await global.database.removeMessageReaction(message, user.id, id, dispatch_name);

        if (!tryUnReact) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }
        
        const payload = {
            channel_id: channel.id,
            message_id: message.id,
            user_id: user.id,
            emoji: {
                id: id,
                name: dispatch_name
            }
        };
        
        if (guild)
            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "MESSAGE_REACTION_REMOVE", payload);
        else
            await global.dispatcher.dispatchEventInPrivateChannel(channel.id, "MESSAGE_REACTION_REMOVE", payload);

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.put("/:urlencoded/@me", channelPermissionsMiddleware("ADD_REACTIONS"), rateLimitMiddleware(global.config.ratelimit_config.addReaction.maxPerTimeFrame, global.config.ratelimit_config.addReaction.timeFrame), async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let channel = req.channel;

        if (!channel) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let guild = req.guild;

        if (channel.type != 1 && channel.type != 3 && !guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let message = req.message;

        if (!message) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Message"
            });
        }

        if (guild && guild.exclusions.includes("reactions")) {
            return res.status(400).json({
                code: 400,
                message: "Reactions are disabled in this server due to its maximum support"
            });
        }

        let encoded = req.params.urlencoded;
        let dispatch_name = decodeURIComponent(encoded);
        let id = null;

        if (encoded.includes(":")) {
            id = encoded.split(':')[1];
            encoded = encoded.split(':')[0];
            dispatch_name = encoded;
        }

        let tryReact = await global.database.addMessageReaction(message, account.id, id, encoded);

        if (!tryReact) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }
        
        const payload = {
            channel_id: channel.id,
            message_id: message.id,
            user_id: account.id,
            emoji: {
                id: id,
                name: dispatch_name
            }
        };

        if (guild)
            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "MESSAGE_REACTION_ADD", payload);
        else
            await global.dispatcher.dispatchEventInPrivateChannel(channel.id, "MESSAGE_REACTION_ADD", payload);

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.get("/:urlencoded", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let channel = req.channel;

        if (!channel) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let guild = req.guild;

        if (channel.type != 1 && channel.type != 3 && !guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let message = req.message;

        if (!message) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Message"
            });
        }

        if (guild && guild.exclusions.includes("reactions")) {
            return res.status(400).json({
                code: 400,
                message: "Reactions are disabled in this server due to its maximum support"
            });
        }

        let encoded = req.params.urlencoded;
        let dispatch_name = decodeURIComponent(encoded);
        let id = null;

        if (encoded.includes(":")) {
            id = encoded.split(':')[1];
            encoded = encoded.split(':')[0];
            dispatch_name = encoded;
        }

        let limit = req.query.limit;

        if (limit > 100 || !limit) {
            limit = 100;
        }

        let reactions = message.reactions;

        let filteredReactions = reactions.filter(x => x.emoji.name == dispatch_name && x.emoji.id == id);

        let return_users = [];

        for(var filteredReaction of filteredReactions) {
            let user = await global.database.getAccountByUserId(filteredReaction.user_id);

            if (user == null) continue;

            return_users.push(globalUtils.miniUserObject(user));
        }

        return res.status(200).json(return_users);
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

module.exports = router;
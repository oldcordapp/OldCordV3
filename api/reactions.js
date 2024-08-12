const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const { channelPermissionsMiddleware, rateLimitMiddleware } = require('../helpers/middlewares');
const dispatcher = require('../helpers/dispatcher');
const fs = require('fs');
const mime = require('mime');
const multer = require('multer');
const sizeOf = require('image-size');
const permissions = require('../helpers/permissions');
const Snowflake = require('../helpers/snowflake');

const router = express.Router({ mergeParams: true });

router.put("/:urlencoded/@me",  channelPermissionsMiddleware("ADD_REACTIONS"), rateLimitMiddleware(100, 1000 * 10), rateLimitMiddleware(1000, 1000 * 60 * 60), async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let message = req.message;

        if (!message) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Message"
            });
        }

        let guild = req.quild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        if (guild.exclusions.includes("reactions")) {
            return res.status(400).json({
                code: 400,
                message: "Reactions are disabled in this server due to its maximum support"
            });
        }

        return res.status(204).send();

        /*
        let encoded = req.params.urlencoded;

        let getMsgReactions = await globalUtils.database.getMessageReactions(message.id);

        let specificEmoji = getMsgReactions.find(x => x.emoji.id == encoded);

        getMsgReactions.push({
            user_id: account.id,
            emoji: {
                id: encoded,
                name: encoded
            }
        });

        for(var emoji of specificEmoji) {
            emoji.me = emoji.user_id == account.id,
            emoji.count = 1;
        }


        
        return res.status(200).json(specificEmoji);
        */
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

module.exports = router;
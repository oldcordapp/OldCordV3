const express = require('express');
const gateway = require('../gateway');
const database = require('../helpers/database');
const { logText } = require('../helpers/logger');
const { instanceMiddleware, rateLimitMiddleware, channelPermissionsMiddleware } = require('../helpers/middlewares');
const dispatcher = require('../helpers/dispatcher');

const router = express.Router({ mergeParams: true });

router.get("/:code", async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const invite = await database.getInvite(req.params.code);

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        delete invite.temporary;
        delete invite.revoked;
        delete invite.uses;
        delete invite.max_uses;
        delete invite.max_age;
        delete invite.xkcdpass;

        return res.status(200).json(invite);
    } catch (error) {
        logText(error.toString(), "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.delete("/:code", channelPermissionsMiddleware("MANAGE_CHANNEL"), rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const invite = await database.getInvite(req.params.code);

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        const channel = await database.getChannelById(invite.channel.id);

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        const tryDelete = await database.deleteInvite(req.params.code);

        if (!tryDelete) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(204).send();
    } catch (error) {
        logText(error.toString(), "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.post("/:code", instanceMiddleware("NO_INVITE_USE"), rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender || !sender.token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const invite = await database.getInvite(req.params.code);

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        const guild = await database.getGuildById(invite.guild.id);

        if (guild == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        delete invite.temporary;
        delete invite.revoked;
        delete invite.uses;
        delete invite.max_uses;
        delete invite.max_age;
        delete invite.xkcdpass;

        const client = gateway.clients.filter(x => x.token == sender.token)[0];

        if (client == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const joinAttempt = await database.useInvite(req.params.code, sender.id);

        if (!joinAttempt) {
            return res.status(404).json({
                code: 10006,
                message: "Invalid Invite"
            });
        }

        dispatcher.dispatchEventTo(sender.token, "GUILD_CREATE", guild);

        await dispatcher.dispatchEventInGuild(invite.guild.id, "GUILD_MEMBER_ADD", {
            roles: [],
            user: {
                username: sender.username,
                discriminator: sender.discriminator,
                id: sender.id,
                avatar: sender.avatar
            },
            guild_id: invite.guild.id
        });

        await dispatcher.dispatchEventInGuild(invite.guild.id, "PRESENCE_UPDATE", {
            game_id: null,
            status: "online",
            user: {
                username: sender.username,
                discriminator: sender.discriminator,
                id: sender.id,
                avatar: sender.avatar
            },
            guild_id: invite.guild.id
        })

        return res.status(200).send(invite);
    } catch (error) {
        logText(error.toString(), "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

module.exports = router;
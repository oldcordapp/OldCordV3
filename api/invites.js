const express = require('express');
const globalUtils = require('../helpers/globalutils');
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

        const invite = await globalUtils.database.getInvite(req.params.code);

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

router.delete("/:code", rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const invite = await globalUtils.database.getInvite(req.params.code);

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        console.log(invite);

        const channel = await globalUtils.database.getChannelById(invite.channel.id);

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        const guild = await globalUtils.database.getGuildById(channel.guild_id);

        if (guild == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            }); 
        }

        const hasPermission = await globalUtils.permissions.hasChannelPermissionTo(channel, guild, sender.id, "MANAGE_CHANNELS");

        if (!hasPermission) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            }); 
        }

        const tryDelete = await globalUtils.database.deleteInvite(req.params.code);

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

        const invite = await globalUtils.database.getInvite(req.params.code);

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        const guild = await globalUtils.database.getGuildById(invite.guild.id);

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

        const joinAttempt = await globalUtils.database.useInvite(req.params.code, sender.id);

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
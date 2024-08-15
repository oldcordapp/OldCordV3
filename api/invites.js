const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const { instanceMiddleware, rateLimitMiddleware, channelPermissionsMiddleware } = require('../helpers/middlewares');
const dispatcher = global.dispatcher;

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

        const invite = await global.database.getInvite(req.params.code);

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        return res.status(200).json(invite);
    } catch (error) {
        logText(error, "error");

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
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const invite = await global.database.getInvite(req.params.code);

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        const channel = await global.database.getChannelById(invite.channel.id);

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        const guild = await global.database.getGuildById(channel.guild_id);

        if (guild == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            }); 
        }

        const hasPermission = await global.permissions.hasChannelPermissionTo(channel, guild, sender.id, "MANAGE_CHANNELS");

        if (!hasPermission) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            }); 
        }

        const tryDelete = await global.database.deleteInvite(req.params.code);

        if (!tryDelete) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");

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

        const invite = await global.database.getInvite(req.params.code);

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        const guild = await global.database.getGuildById(invite.guild.id);

        if (guild == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }
        
        const joinAttempt = await global.database.useInvite(req.params.code, sender.id);

        if (!joinAttempt) {
            return res.status(404).json({
                code: 10006,
                message: "Invalid Invite"
            });
        }

        await global.dispatcher.dispatchEventTo(sender.id, "GUILD_CREATE", guild);

        await global.dispatcher.dispatchEventInGuild(invite.guild.id, "GUILD_MEMBER_ADD", {
            roles: [],
            user: globalUtils.miniUserObject(sender),
            guild_id: invite.guild.id
        });

        await global.dispatcher.dispatchEventInGuild(invite.guild.id, "PRESENCE_UPDATE", {
            game_id: null,
            status: "online",
            user: globalUtils.miniUserObject(sender),
            guild_id: invite.guild.id
        })

        return res.status(200).send(invite);
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

module.exports = router;
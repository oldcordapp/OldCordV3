const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const { instanceMiddleware, rateLimitMiddleware } = require('../helpers/middlewares');

const router = express.Router({ mergeParams: true });

router.param('code', async (req, res, next, memberid) => {
    req.invite = await global.database.getInvite(req.params.code);
    

    if (!req.guild && req.invite && req.invite.channel.guild_id) {
        req.guild = await global.database.getGuildById(req.invite.channel.guild_id);
    }

    next();
});

router.get("/:code", async (req, res) => {
    try {
        const invite = req.invite;

        if (!invite) {
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

router.delete("/:code", rateLimitMiddleware(global.config.ratelimit_config.deleteInvite.maxPerTimeFrame, global.config.ratelimit_config.deleteInvite.timeFrame), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const invite = req.invite;

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        const channel = req.guild.channels.find(x => x.id === invite.channel.id);

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        const guild = req.guild;

        const hasPermission = await global.permissions.hasChannelPermissionTo(channel, guild, sender.id, "MANAGE_CHANNELS");

        if (!hasPermission) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            }); 
        }

        const tryDelete = await global.database.deleteInvite(req.params.code);

        if (!tryDelete) {
            await globalUtils.unavailableGuild(req.guild, "Deleting invite failed");

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

router.post("/:code", instanceMiddleware("NO_INVITE_USE"), rateLimitMiddleware(global.config.ratelimit_config.useInvite.maxPerTimeFrame, global.config.ratelimit_config.useInvite.timeFrame), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender || sender.bot) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const invite = req.invite;

        if (invite == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        let guild = req.guild;

        if (guild == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Invite"
            });
        }

        let usersGuild = await global.database.getUsersGuilds(sender.id);

        if (usersGuild.length >= global.config.limits['guilds_per_account'].max) {
            return res.status(404).json({
                code: 404,
                message: `Maximum number of guilds exceeded for this instance (${global.config.limits['guilds_per_account'].max})`
            });
        }
        
        const joinAttempt = await global.database.useInvite(req.params.code, sender.id);

        if (!joinAttempt) {
            return res.status(404).json({
                code: 10006,
                message: "Invalid Invite"
            });
        }

        guild = await global.database.getGuildById(guild.id); //update to keep in sync?

        await global.dispatcher.dispatchEventTo(sender.id, "GUILD_CREATE", guild);

        await global.dispatcher.dispatchEventInGuild(guild, "GUILD_MEMBER_ADD", {
            roles: [],
            user: globalUtils.miniUserObject(sender),
            guild_id: invite.guild.id
        });

        await global.dispatcher.dispatchEventInGuild(guild, "PRESENCE_UPDATE", {
            game_id: null,
            status: "online",
            activities: [],
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
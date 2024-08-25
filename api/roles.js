const express = require('express');
const { logText } = require('../helpers/logger');
const { rateLimitMiddleware, guildPermissionsMiddleware } = require('../helpers/middlewares');

const router = express.Router({ mergeParams: true });

router.param('roleid', async (req, res, next, roleid) => {
    req.role = req.guild.roles.find(x => x.id === roleid);

    next();
});

router.get("/:roleid", async (req, res) => {
    return res.status(200).json(req.role);
});

router.patch("/:roleid", guildPermissionsMiddleware("MANAGE_ROLES"), rateLimitMiddleware(global.config.ratelimit_config.updateRole.maxPerTimeFrame, global.config.ratelimit_config.updateRole.timeFrame), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let roles = req.guild.roles;

        if (roles.length == 0) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Role"
            });
        }

        let role = req.role;

        if (role == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Role"
            });
        }

        if (req.body.name != "@everyone" && req.params.roleid == req.params.guildid) {
            return res.status(403).json({
                code: 403,
                message: "Cannot modify name of everyone role."
            });
        }

        req.body.permissions = req.body.permissions ?? role.permissions;
        req.body.color = req.body.color ?? role.color;
        req.body.hoist = req.body.hoist ?? role.hoist;
        req.body.mentionable = req.body.mentionable ?? role.mentionable;
        req.body.name = req.body.name || "new role";
        req.body.position = req.body.position ?? role.position;

        const attempt = await global.database.updateRole(
            req.params.roleid,
            req.body.name,
            req.body.color,
            req.body.hoist,
            req.body.mentionable,
            req.body.permissions,
            req.body.position
        );

        if (attempt) {
            role.name = req.body.name;
            role.permissions = req.body.permissions ?? 0;
            role.position = req.body.position ?? role.position;
            
            await global.dispatcher.dispatchEventTo(sender.id, "GUILD_ROLE_UPDATE", {
                guild_id: req.params.guildid,
                role: role
            });

            await global.dispatcher.dispatchEventToAllPerms(req.params.guildid, null, "MANAGE_ROLES", "GUILD_ROLE_UPDATE", {
                guild_id: req.params.guildid,
                role: role
            });

            return res.status(200).json(role);
        } else {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.delete("/:roleid", guildPermissionsMiddleware("MANAGE_ROLES"), rateLimitMiddleware(global.config.ratelimit_config.deleteRole.maxPerTimeFrame, global.config.ratelimit_config.deleteRole.timeFrame), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let role = req.role;

        if (role == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Role"
            });
        }

        const attempt = await global.database.deleteRole(req.params.roleid);

        if (!attempt) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventInGuild(req.guild, "GUILD_ROLE_DELETE", {
            guild_id: req.params.guildid,
            role_id: req.params.roleid
        });

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/", guildPermissionsMiddleware("MANAGE_ROLES"), rateLimitMiddleware(global.config.ratelimit_config.createRole.maxPerTimeFrame, global.config.ratelimit_config.createRole.timeFrame), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null || !sender.token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }
        
        const role = await global.database.createRole(req.params.guildid, "new role", 0, 1);

        if (role == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventTo(sender.id, "GUILD_ROLE_CREATE", {
            guild_id: req.params.guildid,
            role: role
        });

        await global.dispatcher.dispatchEventToAllPerms(req.params.guildid, null, "MANAGE_ROLES", "GUILD_ROLE_CREATE", {
            guild_id: req.params.guildid,
            role: role
        });

        return res.status(200).json(role);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
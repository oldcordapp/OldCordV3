const express = require('express');
const { logText } = require('../helpers/logger');
const { rateLimitMiddleware, guildPermissionsMiddleware } = require('../helpers/middlewares');
const globalUtils = require('../helpers/globalutils');

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

        let guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
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
                name: "Cannot modify name of everyone role."
            });
        }

        if (req.body.name.length < global.config.limits['role_name'].min || req.body.name.length >= global.config.limits['role_name'].max) {
            return res.status(400).json({
                code: 400,
                name: `Must be between ${global.config.limits['role_name'].min} and ${global.config.limits['role_name'].max} characters.`
            });
        }

        role.permissions = req.body.permissions ?? role.permissions;
        role.color = req.body.color ?? role.color;
        role.hoist = req.body.hoist ?? role.hoist;
        role.mentionable = req.body.mentionable ?? role.mentionable;
        role.name = req.body.name || "new role";
        role.position = req.body.position ?? role.position;

        const attempt = await global.database.updateRole(role);

        if (attempt) {
            role.name = req.body.name;
            role.permissions = req.body.permissions ?? 0;
            role.position = req.body.position ?? role.position;

            await global.dispatcher.dispatchEventInGuild(guild, "GUILD_ROLE_UPDATE", {
                guild_id: guild.id,
                role: role
            });

            return res.status(200).json(role);
        } else {
            await globalUtils.unavailableGuild(req.guild, "Roles update failed");

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

        let guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            }); 
        }

        let role = req.role;

        if (role == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Role"
            });
        }

        let members_with_role = req.guild.members.filter(x => x.roles.some(y => y === role.id));

        const attempt = await global.database.deleteRole(req.params.roleid);

        if (!attempt) {
            await globalUtils.unavailableGuild(req.guild, "Deleting role failed");

            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventInGuild(req.guild, "GUILD_ROLE_DELETE", {
            guild_id: req.params.guildid,
            role_id: req.params.roleid
        });

        if (members_with_role.length > 0) {
            for(var member_with_role of members_with_role) {
                let member_with_roles = member_with_role.roles;

                member_with_roles = member_with_roles.filter(x => x !== role.id);
    
                await global.dispatcher.dispatchEventInGuild(req.guild, "GUILD_MEMBER_UPDATE", {
                    roles: member_with_roles,
                    user: globalUtils.miniUserObject(member_with_role.user),
                    guild_id: req.guild.id,
                    nick: member_with_role.nick
                });
            }
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

router.patch("/", guildPermissionsMiddleware("MANAGE_ROLES"), rateLimitMiddleware(global.config.ratelimit_config.updateRole.maxPerTimeFrame, global.config.ratelimit_config.createRole.timeFrame), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        let roles = req.body;

        if (!Array.isArray(roles)) {
            return res.status(400).json({
                code: 400,
                message: "Bad payload"
            });
        }

        let success = 0;
        let retRoles = [];

        for(var role of roles) {
            if (!role.id || !role.position) continue;

            if (Object.keys(role).length > 2) continue; //fuck you

            let guildRole = guild.roles.find(x => x.id === role.id);

            if (!guildRole) continue;
            
            let update_this_role = guildRole.position != role.position;

            if (update_this_role) {
                guildRole.position = role.position;

                let tryUpdate = await global.database.updateRole(guildRole);

                if (!tryUpdate) continue;

                await global.dispatcher.dispatchEventInGuild(guild, "GUILD_ROLE_UPDATE", {
                    guild_id: guild.id,
                    role: guildRole
                });
            }

            retRoles.push(guildRole);

            success++;
        }

        if (success !== roles.length) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(200).json(retRoles);
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

        let guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        if (guild.roles.length >= global.config.limits['roles_per_guild'].max) {
            return res.status(400).json({
                code: 400,
                message: `Maximum number of roles per guild exceeded (${global.config.limits['roles_per_guild'].max})`
            });
        }
        
        const role = await global.database.createRole(req.params.guildid, "new role", req.guild.roles.length + 1);

        if (role == null) {
            await globalUtils.unavailableGuild(req.guild, "Creating role failed");

            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventInGuild(guild, "GUILD_ROLE_UPDATE", {
            guild_id: guild.id,
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
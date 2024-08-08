const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const { rateLimitMiddleware, guildPermissionsMiddleware } = require('../helpers/middlewares');
const dispatcher = require('../helpers/dispatcher');

const router = express.Router({ mergeParams: true });

router.param('memberid', async (req, res, next, memberid) => {
    req.member = await globalUtils.database.getGuildMemberById(req.params.guildid, memberid);

    next();
});

router.delete("/:memberid", guildPermissionsMiddleware("KICK_MEMBERS"), rateLimitMiddleware(200, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const member = req.member;

        if (member == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Member"
            });
        }

        const attempt = await globalUtils.database.leaveGuild(member.id, req.params.guildid);

        if (!attempt) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        dispatcher.dispatchEventTo(sender.token, "GUILD_DELETE", {
            id: req.params.guildid
        });

        await dispatcher.dispatchEventInGuild(req.params.guildid, "GUILD_MEMBER_REMOVE", {
            type: "kick",
            moderator: {
                username: sender.username,
                avatar: sender.avatar,
                discriminator: sender.discriminator,
                id: sender.id
            },
            roles: [],
            user: {
                username: member.user.username,
                discriminator: member.user.discriminator,
                id: member.user.id,
                avatar: member.user.avatar
            },
            guild_id: req.params.guildid
        })

        return res.status(204).send();
    } catch (error) {
        console.log(error.toString());
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:memberid", guildPermissionsMiddleware("MANAGE_ROLES"), rateLimitMiddleware(200, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const member = req.member;

        if (member == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Member"
            });
        }

        const roles = [];

        if (req.body.roles.length == 0) {
            const tryClearRoles = await globalUtils.database.clearRoles(req.params.guildid, member.id);

            if (!tryClearRoles) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
        } else {
            for(var role of req.body.roles) {
                if (JSON.stringify(role).includes("id")) {
                    let RoleObj = role;

                    roles.push(RoleObj.id);
                } else {
                    roles.push(role);
                }
            }

            if (!roles.includes(req.params.guildid)) {
                roles.push(req.params.guildid);
            }

            for(var role_id of roles) {
                const attempt = await globalUtils.database.addRole(req.params.guildid, role_id, member.id);
    
                if (!attempt) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }
            }
        }

        await dispatcher.dispatchEventInGuild(req.params.guildid, "GUILD_MEMBER_UPDATE", {
            roles: member.roles,
            user: member.user,
            guild_id: req.params.guildid
        });

        return res.status(200).json({
            user: member.user,
            guild_id: req.params.guildid,
            roles: roles,
            deaf: false,
            mute: false
        });
    } catch (error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
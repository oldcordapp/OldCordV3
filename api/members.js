const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const { rateLimitMiddleware, guildPermissionsMiddleware } = require('../helpers/middlewares');

const router = express.Router({ mergeParams: true });

router.param('memberid', async (req, res, next, memberid) => {
    req.member = await global.database.getGuildMemberById(req.params.guildid, memberid);

    next();
});

router.get("/:memberid", async (req, res) => {
    return res.status(200).json(req.member);
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

        const attempt = await global.database.leaveGuild(member.id, req.params.guildid);

        if (!attempt) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventTo(member.id, "GUILD_DELETE", {
            id: req.params.guildid
        });

        await global.dispatcher.dispatchEventInGuild(req.params.guildid, "GUILD_MEMBER_REMOVE", {
            type: "kick",
            moderator: globalUtils.miniUserObject(sender),
            roles: [],
            user: globalUtils.miniUserObject(member.user),
            guild_id: req.params.guildid
        })

        return res.status(204).send();
    } catch (error) {
        console.log(error);
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:memberid", guildPermissionsMiddleware("MANAGE_ROLES"), guildPermissionsMiddleware("MANAGE_NICKNAMES"), rateLimitMiddleware(200, 1000 * 60 * 60), async (req, res) => {
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

        let roles;
        
        if (!req.body.roles) {
            roles = member.roles;
        } else {
            roles = [];
            if (req.body.roles.length == 0) {
                const tryClearRoles = await global.database.clearRoles(req.params.guildid, member.id);

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
                    const attempt = await global.database.addRole(req.params.guildid, role_id, member.id);
        
                    if (!attempt) {
                        return res.status(500).json({
                            code: 500,
                            message: "Internal Server Error"
                        });
                    }
                }
            }
        }

        let reset = req.body.nick == "";

        let nick = req.body.nick;
        
        if (nick) {
            nick = member.nick;
        } else {
            if (nick && nick.length < 2 && !reset) {
                return res.status(400).json({
                    code: 400,
                    nick: "Nickname must be between 2 and 30 characters."
                });
            }

            if (nick && nick.length > 30 && !reset) {
                return res.status(400).json({
                    code: 400,
                    nick: "Nickname must be between 2 and 30 characters."
                });
            }

            if (nick == member.user.username) {
                reset = true;
                nick = null;
            }
        }

        if (nick || reset) {
            let tryUpdateNick = await global.database.updateGuildMemberNick(req.params.guildid, member.user.id, nick);

            if (!tryUpdateNick) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            member.nick = nick;
        }
        
        await global.dispatcher.dispatchEventInGuild(req.params.guildid, "GUILD_MEMBER_UPDATE", {
            roles: roles,
            user: member.user,
            guild_id: req.params.guildid,
            nick: nick
        });

        return res.status(200).json({
            user: member.user,
            nick: nick,
            guild_id: req.params.guildid,
            roles: roles,
            deaf: false,
            mute: false
        });
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/@me/nick", guildPermissionsMiddleware("CHANGE_NICKNAME"), rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
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

        let nick = req.body.nick;
        let reset = !nick;

        if (nick.length < 2 && !reset) {
            return res.status(400).json({
                code: 400,
                nick: "Nickname must be between 2 and 20 characters."
            });
        }

        if (nick.length > 30 && !reset) {
            return res.status(400).json({
                code: 400,
                nick: "Nickname must be between 2 and 20 characters."
            });
        }

        if (reset) nick = null;

        let tryUpdate = await global.database.updateGuildMemberNick(guild.id, account.id, nick);

        if (!tryUpdate) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }
        
        let member = await global.database.getGuildMemberById(guild.id, account.id);

        if (!member) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventInGuild(req.params.guildid, "GUILD_MEMBER_UPDATE", {
            roles: member.roles,
            user: member.user,
            guild_id: req.params.guildid,
            nick: nick
        });

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
    //updateGuildMemberNick
});

module.exports = router;
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

async function updateMember(member, guild_id, roles, nick) {
    let rolesChanged = false;
    if (!roles) {
        //No change
        roles = member.roles;
    } else {
        //New roles list
        let newRoles = [];
        for(var role of roles) {
            if (JSON.stringify(role).includes("id")) {
                let RoleObj = role;

                newRoles.push(RoleObj.id);
            } else {
                newRoles.push(role);
            }
        }
        
        if (!newRoles.includes(guild_id)) {
            //Ensure @everyone is in the member's role list
            newRoles.push(guild_id);
        }
        
        if (member.roles.length != newRoles.length) {
            rolesChanged = true;
        } else {
            for (let i = 0; i < member.roles.length; i++) {
                if (member.roles[i] != newRoles[i]) {
                    rolesChanged = true;
                    break;
                }
            }
        }

        if (rolesChanged) {
            roles = newRoles;
            
            if (!await global.database.setRoles(guild_id, roles, member.id)) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
        }
    }

    if (nick == null || nick === undefined) {
        //No change
        nick = member.nick;
    } else {
        //Change
        if (nick === "" || nick == member.user.username) {
            //Reset nick
            nick = null;
        } else {
            //Set new nick
            if (nick.length < 2) {
                return res.status(400).json({
                    code: 400,
                    nick: "Nickname must be between 2 and 30 characters."
                });
            }

            if (nick.length > 30) {
                return res.status(400).json({
                    code: 400,
                    nick: "Nickname must be between 2 and 30 characters."
                });
            }
        }

        if (nick != member.nick) {
            let tryUpdateNick = await global.database.updateGuildMemberNick(guild_id, member.user.id, nick);

            if (!tryUpdateNick) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            member.nick = nick;
        }
    }

    let newMember = {
        roles: roles,
        user: member.user,
        guild_id: guild_id,
        nick: nick
    };

    if (rolesChanged || newMember.nick !== member.nick)
        await global.dispatcher.dispatchEventInGuild(guild_id, "GUILD_MEMBER_UPDATE", newMember);
    
    return newMember;
}

router.patch("/:memberid", guildPermissionsMiddleware("MANAGE_ROLES"), guildPermissionsMiddleware("MANAGE_NICKNAMES"), rateLimitMiddleware(200, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (req.member == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Member"
            });
        }

        let newMember = await updateMember(req.member, req.guild.id, req.body.roles, req.body.nick);

        return res.status(200).json({
            user: newMember.user,
            nick: newMember.nick,
            guild_id: req.guild.id,
            roles: newMember.roles,
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
        
        let member = req.guild.members.find(y => y.id == account.id);

        if (!member) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }
        
        let newMember = await updateMember(member, req.guild.id, null, req.body.nick);

        await global.dispatcher.dispatchEventInGuild(req.guild.id, "GUILD_MEMBER_UPDATE", {
            roles: newMember.roles,
            user: newMember.user,
            guild_id: req.guild.id,
            nick: newMember.nick
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
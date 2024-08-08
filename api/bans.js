const express = require('express');
const { logText } = require('../helpers/logger');
const globalUtils = require('../helpers/globalutils');
const { rateLimitMiddleware, guildPermissionsMiddleware } = require('../helpers/middlewares');
const dispatcher = require('../helpers/dispatcher');

const router = express.Router({ mergeParams: true });

router.param('memberid', async (req, res, next, memberid) => {
    req.member = await globalUtils.database.getGuildMemberById(req.params.guildid, memberid);
    
    next();
});

router.get("/", guildPermissionsMiddleware("BAN_MEMBERS"), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const bans = await globalUtils.database.getGuildBans(req.params.guildid);

        return res.status(200).json(bans);
    } catch (error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.put("/:memberid", guildPermissionsMiddleware("BAN_MEMBERS"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender || !sender.token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (sender.id == req.params.memberid) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
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
        const tryBan = await globalUtils.database.banMember(req.params.guildid, member.id);

        if (!attempt || !tryBan) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const member_account = await globalUtils.database.getAccountByUserId(member.id);

        dispatcher.dispatchEventTo(member_account.token, "GUILD_DELETE", {
            id: req.params.guildid
        });

        await dispatcher.dispatchEventInGuild(req.params.guildid, "GUILD_MEMBER_REMOVE", {
            type: "ban",
            moderator: {
                username: sender.username,
                avatar: sender.avatar,
                discriminator: sender.discriminator,
                id: sender.id
            },
            user: {
                username: member.user.username,
                discriminator: member.user.discriminator,
                id: member.user.id,
                avatar: member.user.avatar
            },
            roles: [],
            guild_id: req.params.guildid
        })

        dispatcher.dispatchEventTo(sender.token, "GUILD_MEMBER_ADD", {
            guild_id: req.params.guildid,
            user: {
                username: member.user.username,
                avatar: member.user.avatar,
                id: member.user.id,
                discriminator: member.user.discriminator
            },
            roles: []
        });

        if (req.query['delete-message-days']) {
            let deleteMessageDays = parseInt(req.query['delete-message-days']);

            if (deleteMessageDays > 7) {
                deleteMessageDays = 7;
            }

            if (deleteMessageDays > 0) {
                let messages = await globalUtils.database.getUsersMessagesInGuild(req.params.guildid, member.user.id);

                const deletemessagedaysDate = new Date();
                
                deletemessagedaysDate.setDate(deletemessagedaysDate.getDate() - deleteMessageDays);

                messages = messages.filter(message => {
                    const messageTimestamp = new Date(message.timestamp);
                    
                    return messageTimestamp >= deletemessagedaysDate;
                });

                if (messages.length > 0) {
                    for(var message of messages) {
                        let tryDelete = await globalUtils.database.deleteMessage(message.id);

                        if (tryDelete) {
                            await dispatcher.dispatchEventInChannel(message.channel_id, "MESSAGE_DELETE", {
                                id: message.id,
                                guild_id: req.params.guildid,
                                channel_id: message.channel_id
                            })
                        }
                    }
                }
            }
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

router.delete("/:memberid", guildPermissionsMiddleware("BAN_MEMBERS"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender || !sender.token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (sender.id == req.params.memberid) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        const bans = await globalUtils.database.getGuildBans(req.params.guildid);

        const ban = bans.find(x => x.user.id == req.params.memberid);

        if (!ban) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Ban"
            });
        }

        const attempt = await globalUtils.database.unbanMember(req.params.guildid, req.params.memberid);

        if (!attempt) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        dispatcher.dispatchEventTo(sender.token, "GUILD_BAN_REMOVE", {
            guild_id: req.params.guildid,
            user: ban.user,
            roles: []
        });

        return res.status(204).send();
    } catch (error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
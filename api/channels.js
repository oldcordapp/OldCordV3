const express = require('express');
const { logText } = require('../helpers/logger');
const messages = require('./messages');
const { channelPermissionsMiddleware, rateLimitMiddleware, guildPermissionsMiddleware, channelMiddleware } = require('../helpers/middlewares');
const globalUtils = require('../helpers/globalutils');

const router = express.Router({ mergeParams: true });
const config = globalUtils.config;

router.param('channelid', async (req, res, next, channelid) => {
    const channel = await global.database.getChannelById(channelid);

    if (channel == null) {
        let dmChannel = await global.database.getDMChannelById(channelid);

        if (dmChannel == null) {
            req.channel = null;
        } else {
            let user = await global.database.getAccountByToken(req.headers['authorization']);

            if (user != null) {
                if (dmChannel.author_of_channel_id == user.id) {
                    req.channel = {
                        id: dmChannel.id,
                        name: "",
                        topic: "",
                        position: 0,
                        type: req.channel_types_are_ints ? 1 : "text",
                        recipient: globalUtils.miniUserObject(user),
                        guild_id: null,
                        is_private: true,
                        permission_overwrites: [] 
                    }
                } else {
                    req.channel = {
                        id: dmChannel.id,
                        name: "",
                        topic: "",
                        position: 0,
                        type: req.channel_types_are_ints ? 1 : "text",
                        recipient: globalUtils.miniUserObject(user),
                        guild_id: null,
                        is_private: true,
                        permission_overwrites: [] 
                    }
                }
            } else req.channel = null;
        }
    } else {
        if (req.channel_types_are_ints) {
            channel.type = parseInt(channel.type);
        } else channel.type = parseInt(channel.type) == 2 ? "voice" : "text"

        req.channel = channel;

        if (channel && channel.guild_id) {
            req.guild = await global.database.getGuildById(channel.guild_id);
        }
    }

    next();
});

router.get("/:channelid", channelMiddleware, channelPermissionsMiddleware("READ_MESSAGE_HISTORY"), async (req, res) => {
    return res.status(200).json(req.channel);
});

router.post("/:channelid/typing", channelMiddleware, channelPermissionsMiddleware("READ_MESSAGE_HISTORY"), channelPermissionsMiddleware("SEND_MESSAGES"), rateLimitMiddleware(100, 1000 * 60), async (req, res) => {
    try {
        const typer = req.account;

        if (!typer) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const channel = req.channel;

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        if (channel.recipient != null) {
            await global.dispatcher.dispatchEventInDM(typer.id, channel.recipient.id, "TYPING_START", {
                channel_id: req.params.channelid,
                guild_id: channel.guild_id,
                user_id: typer.id,
                timestamp: new Date(),
                member: null
            })
    
            return res.status(204).send();
        } else {
            if (!channel.guild_id) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Channel"
                });
            }

            await global.dispatcher.dispatchEventInChannel(channel.id, "TYPING_START", {
                channel_id: req.params.channelid,
                guild_id: channel.guild_id,
                user_id: typer.id,
                timestamp: new Date(),
                member: {
                    id: typer.id,
                    roles: [],
                    deaf: false,
                    mute: false,
                    user: globalUtils.miniUserObject(typer)
                }
            })

            return res.status(204).send();
        }
      } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:channelid", channelMiddleware, channelPermissionsMiddleware("MANAGE_CHANNELS"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const channel = req.channel;

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        if (!req.body.name) {
            return res.status(400).json({
                code: 404,
                name: "This field is required.",
            });
        } 

        if (req.body.name.length < 1) {
            return res.status(400).json({
                code: 400,
                name: "Must be between 1 and 30 characters",
            });
        }

        if (req.body.name.length > 30) {
            return res.status(400).json({
                code: 400,
                name: "Must be between 1 and 30 characters",
            });
        }

        channel.name = req.body.name;
        channel.position = req.body.position;

        const outcome = await global.database.updateChannel(channel.id, channel);

        if (channel == null || !outcome) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        if (!req.channel_types_are_ints) {
            channel.type = channel.type == 2 ? "voice" : "text";
        }

        await global.dispatcher.dispatchEventToAllPerms(channel.guild_id, channel.id, "READ_MESSAGE_HISTORY", "CHANNEL_UPDATE", channel);

        return res.status(200).json(channel);
      } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.get("/:channelid/invites", channelMiddleware, channelPermissionsMiddleware("MANAGE_CHANNELS"), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const invites = await global.database.getChannelInvites(req.params.channelid);

        return res.status(200).json(invites);
      } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/:channelid/invites", channelMiddleware, channelPermissionsMiddleware("CREATE_INSTANT_INVITE"), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (config.instance_flags.includes("NO_INVITE_CREATION")) {
            return res.status(400).json({
                code: 400,
                message: "Creating invites is not allowed."
            })
        }

        let max_age = 0;
        let max_uses = 0;
        let temporary = false;
        let xkcdpass = false;
        let regenerate = false;

        if (req.body.max_age) {
            max_age = req.body.max_age;
        }

        if (req.body.max_uses) {
            max_uses = req.body.max_uses;
        }
    
        if (req.body.xkcdpass) {
            xkcdpass = req.body.xkcdpass;
        }

        if (req.body.tempoary) {
            temporary = req.body.temporary;
        }

        if (req.body.regenerate) {
            regenerate = true;
        }

        const invite = await global.database.createInvite(req.params.guildid, req.params.channelid, sender.id, temporary, max_uses, max_age, xkcdpass, regenerate);

        if (invite == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
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

router.use("/:channelid/messages", channelMiddleware, messages);

router.put("/:channelid/permissions/:id", channelMiddleware, guildPermissionsMiddleware("MANAGE_ROLES"), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }
    
        let id = req.params.id;
        let channel_id = req.params.channelid;
        let type = req.body.type;

        if (!type) {
            type = 'role';
        }

        if (type != 'member' && type != 'role') {
            return res.status(404).json({
                code: 404,
                message: "Unknown Type"
            });
        }
        
        let channel = req.channel;

        if (channel == null || !channel.guild_id) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let channel_overwrites = await global.database.getChannelPermissionOverwrites(channel.id);
        let overwrites = channel_overwrites;
        let overwriteIndex = channel_overwrites.findIndex(x => x.id == id);
        let allow = 0;
        let deny = 0;

        let permissionValuesObject = global.permissions.toObject();
        let permissionKeys = Object.keys(permissionValuesObject);
        let keys = permissionKeys.map((key) => permissionValuesObject[key]);

        for (let permValue of keys) {
            if (!!(req.body.allow & permValue)) {
                allow |= permValue;
            }

            if (!!(req.body.deny & permValue)) {
                deny |= permValue;
            }
        }

        if (overwriteIndex === -1) {
            overwrites.push({
                id: id,
                allow: allow,
                deny: deny,
                type: type
            })
        } else {
            overwrites[overwriteIndex] = {
                id: id,
                allow: allow,
                deny: deny,
                type: type
            };
        }

        if (type == 'member') {
            let member = await global.database.getGuildMemberById(channel.guild_id, id);

            if (member == null) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Member"
                });
            }
        } else {
            let role = await global.database.getRoleById(id);

            if (role == null) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Role"
                });
            }
        }

        await global.database.updateChannelPermissionOverwrites(channel.id, overwrites);

        channel = await global.database.getChannelById(channel_id);

        if (!channel?.guild_id) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        if (!req.channel_types_are_ints) {
            channel.type = channel.type == 2 ? "voice" : "text";
        }

        await global.dispatcher.dispatchEventInChannel(channel.id, "CHANNEL_UPDATE", {
            type: channel.type,
            id: channel.id,
            guild_id: channel.guild_id,
            topic: channel.topic,
            last_message_id: channel.last_message_id,
            name: channel.name,
            permission_overwrites: channel.permission_overwrites
        });

        return res.status(204).send();
    } catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.delete("/:channelid/permissions/:id", channelMiddleware, guildPermissionsMiddleware("MANAGE_ROLES"), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender || !sender.token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let id = req.params.id;
        let channel_id = req.params.channelid;
        
        let channel = req.channel;

        if (channel == null || !channel.guild_id) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let channel_overwrites = await global.database.getChannelPermissionOverwrites(channel.id);
        let overwriteIndex = channel_overwrites.findIndex(x => x.id == id);

        if (!req.channel_types_are_ints) {
            channel.type = channel.type == 2 ? "voice" : "text";
        }

        if (overwriteIndex === -1) {
            await global.dispatcher.dispatchEventInChannel(channel.id, "CHANNEL_UPDATE", {
                type: channel.type,
                id: channel.id,
                guild_id: channel.guild_id,
                topic: channel.topic,
                last_message_id: channel.last_message_id,
                name: channel.name,
                permission_overwrites: channel.permission_overwrites
            });

            return res.status(204).send();
        }

        await global.database.deleteChannelPermissionOverwrite(channel_id, channel_overwrites[overwriteIndex]);

        channel = await global.database.getChannelById(channel_id);

        if (!channel?.guild_id) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        if (!req.channel_types_are_ints) {
            channel.type = channel.type == 2 ? "voice" : "text";
        }

        await global.dispatcher.dispatchEventInChannel(channel.id, "CHANNEL_UPDATE", {
            type: channel.type,
            id: channel.id,
            guild_id: channel.guild_id,
            topic: channel.topic,
            last_message_id: channel.last_message_id,
            name: channel.name,
            permission_overwrites: channel.permission_overwrites
        });

        return res.status(204).send();
    } catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.delete("/:channelid", channelMiddleware, guildPermissionsMiddleware("MANAGE_CHANNELS"), rateLimitMiddleware(5, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (!sender) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let channel = req.channel;

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        if (!req.channel_types_are_ints) {
            channel.type = channel.type == 2 ? "voice" : "text";
        }

        if (!channel.guild_id) {
            let alreadyClosed = await global.database.isDMClosed(channel.id);

            if (!alreadyClosed) {
                let tryClose = await global.database.closeDMChannel(channel.id);

                if (!tryClose) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }
            }

            await global.dispatcher.dispatchEventTo(sender.id, "CHANNEL_DELETE", {
                id: channel.id,
                guild_id: null
            });
            
            await global.dispatcher.dispatchEventTo(channel.recipient.id, "CHANNEL_DELETE", {
                id: channel.id,
                guild_id: null
            });

            return res.status(204).send();
        } else {
            if (req.params.channelid == req.params.guildid) {
                return res.status(403).json({
                    code: 403,
                    message: "Missing Permissions"
                });
            }

            await global.dispatcher.dispatchEventInChannel(channel.id, "CHANNEL_DELETE", {
                id: channel.id,
                guild_id: channel.guild_id
            });
    
            if (!await global.database.deleteChannel(channel.id)) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
    
            return res.status(204).send();
        }
    } catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
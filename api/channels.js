const express = require('express');
const { logText } = require('../helpers/logger');
const messages = require('./messages');
const webhooks = require("./webhooks");
const pins = require('./pins');
const { channelPermissionsMiddleware, rateLimitMiddleware, guildPermissionsMiddleware, channelMiddleware } = require('../helpers/middlewares');
const globalUtils = require('../helpers/globalutils');

const router = express.Router({ mergeParams: true });
const config = globalUtils.config;

router.param('channelid', async (req, res, next, channelid) => {
    const guild = req.guild;

    if (!guild) {
        //fallback for dm channels & group dms

        req.channel = await global.database.getChannelById(channelid); 

        return next();
    }

    const channel = req.guild.channels.find(y => y.id === channelid);

    if (channel == null) {
        req.channel = null;
        
        return next(); //no channel let's wrap it up - try not to use getChannelById when not necessary
    }

    if (req.channel_types_are_ints) {
        channel.type = parseInt(channel.type);
    } else channel.type = parseInt(channel.type) == 2 ? "voice" : "text"
    
    req.channel = channel;

    if (!req.guild && req.channel.guild_id != null) {
        req.guild = await global.database.getGuildById(req.channel.guild_id);
    } //just in case there is a guild and it's not resolved yet - for future use

    next();
});

router.param('recipientid', async (req, res, next, recipientid) => {
    req.recipient = await global.database.getAccountByUserId(recipientid);

    next();
});

router.get("/:channelid", channelMiddleware, channelPermissionsMiddleware("READ_MESSAGES"), async (req, res) => {
    return res.status(200).json(req.channel);
});

router.post("/:channelid/typing", channelMiddleware, channelPermissionsMiddleware("SEND_MESSAGES"), rateLimitMiddleware(global.config.ratelimit_config.typing.maxPerTimeFrame, global.config.ratelimit_config.typing.timeFrame), async (req, res) => {
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
        
        const payload = {
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
        };
        
        if (!req.guild) {
            if (!req.channel.recipients) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Channel"
                });
            }
            
            await global.dispatcher.dispatchEventInPrivateChannel(channel, "TYPING_START", payload);
        } else {
            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "TYPING_START", payload);
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

router.patch("/:channelid", channelMiddleware, channelPermissionsMiddleware("MANAGE_CHANNELS"), rateLimitMiddleware(global.config.ratelimit_config.updateChannel.maxPerTimeFrame, global.config.ratelimit_config.updateChannel.timeFrame), async (req, res) => {
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

        if (!channel.guild_id && channel.type !== 3) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            }); //Can only modify guild channels lol -- okay update, they can modify group channels too
        }

        if (req.body.icon) {
            channel.icon = req.body.icon;
        }

        if (req.body.icon === null) {
            channel.icon = null;
        }

        if (req.body.name && req.body.name.length < 1) {
            return res.status(400).json({
                code: 400,
                name: "Must be between 1 and 30 characters",
            });
        }

        if (req.body.name && req.body.name.length > 30) {
            return res.status(400).json({
                code: 400,
                name: "Must be between 1 and 30 characters",
            });
        }

        channel.name = req.body.name ?? channel.name;

        if (channel.type !== 3 && channel.type !== 1) {
            channel.position = req.body.position ?? channel.position;
            channel.topic = req.body.topic ?? channel.topic;
            channel.nsfw = req.body.nsfw ?? channel.nsfw;
        } //do this for only guild channels

        const outcome = await global.database.updateChannel(channel.id, channel);

        if (!outcome) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        if (channel.type === 3) {
            channel = outcome;

            if (!channel) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            await global.dispatcher.dispatchEventInPrivateChannel(channel, "CHANNEL_UPDATE", async function() {
                return globalUtils.personalizeChannelObject(this.socket, channel);
            });

            return res.status(200).json(channel);
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
            await globalUtils.unavailableGuild(req.guild, "Something went wrong while creating an invite");

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

router.get("/:channelid/webhooks", channelMiddleware, channelPermissionsMiddleware("MANAGE_WEBHOOKS"), async (req, res) => {
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

        let channel = req.channel;
        
        if (!channel) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });  
        }

        let webhooks = guild.webhooks.filter(x => x.channel_id === req.channel.id);

        return res.status(200).json(webhooks);
    } catch (error) {
        logText(error, "error");
    
        

        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });

        //updateGuildWebhook:
    } 
});

router.post("/:channelid/webhooks",  channelMiddleware, channelPermissionsMiddleware("MANAGE_WEBHOOKS"), async (req, res) => {
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

        let channel = req.channel;

        if (!channel) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });  
        }

        if (!req.body.name) {
            req.body.name = "Captain Hook"; //fuck you 
        }

        let name = req.body.name;

        let webhook = await global.database.createWebhook(guild, account, req.channel.id, name, null);

        if (!webhook) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(200).json(webhook);
    } catch (error) {
        logText(error, "error");
    
        

        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

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

        let channel_overwrites = await global.database.getChannelPermissionOverwrites(req.guild, channel.id);
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
            let member = req.guild.members.find(x => x.id === id);

            if (member == null) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Member"
                });
            }
        } else if (type == 'role') {
            let role = req.guild.roles.find(x => x.id === id);

            if (role == null) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Role"
                });
            }
        }

        await global.database.updateChannelPermissionOverwrites(req.guild, channel.id, overwrites);

        channel = req.guild.channels.find(x => x.id === channel_id);

        if (!req.channel_types_are_ints) {
            channel.type = channel.type == 2 ? "voice" : "text";
        }

        await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "CHANNEL_UPDATE", channel);

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

        let channel_overwrites = await global.database.getChannelPermissionOverwrites(req.guild, channel.id);
        let overwriteIndex = channel_overwrites.findIndex(x => x.id == id);

        if (!req.channel_types_are_ints) {
            channel.type = channel.type == 2 ? "voice" : "text";
        }

        if (overwriteIndex === -1) {
            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "CHANNEL_UPDATE", channel);

            return res.status(204).send();
        }

        await global.database.deleteChannelPermissionOverwrite(req.guild, channel_id, channel_overwrites[overwriteIndex]);

        channel = req.guild.channels.find(x => x.id === channel_id);

        if (!channel?.guild_id) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        if (!req.channel_types_are_ints) {
            channel.type = channel.type == 2 ? "voice" : "text";
        }

        await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "CHANNEL_UPDATE", channel);

        return res.status(204).send();
    } catch(error) {
        logText(error, "error");
 
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

//TODO: should have its own rate limit
router.put("/:channelid/recipients/:recipientid", channelMiddleware, rateLimitMiddleware(global.config.ratelimit_config.updateMember.maxPerTimeFrame, global.config.ratelimit_config.updateMember.timeFrame), async (req, res) => {
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
        
        if (channel.type !== 3) {
            return res.status(403).json({
                code: 403,
                message: "Cannot add members to this type of channel."
            });
        }

        if (!channel.recipients.find(x => x.id === sender.id)) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }
         
        if (channel.recipients.length > 9) {
            return res.status(403).json({
                code: 403,
                message: "Maximum number of members for group reached (10)."
            })
        }
        
        const recipient = req.recipient;
        
        if (recipient == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown user"
            });
        }
        
        if (!globalUtils.areWeFriends(sender, recipient)) {
            return res.status(403).json({
                code: 403,
                message: "You are not friends with the recipient."
            });
        }
        
        //Add recipient
        channel.recipients.push(recipient);
        
        if (!await global.database.updateChannelRecipients(channel.id, channel.recipients))
            throw "Failed to update recipients list in channel";
        
        //Notify everyone else
        await global.dispatcher.dispatchEventInPrivateChannel(channel, "CHANNEL_UPDATE", async function() {
            return globalUtils.personalizeChannelObject(this.socket, channel);
        });
        
        //Notify new recipient
        await globalUtils.pingPrivateChannelUser(channel, recipient.id);
        
        return res.status(204).send();
    } catch(error) {
        logText(error, "error");
        
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.delete("/:channelid/recipients/:recipientid", channelMiddleware, rateLimitMiddleware(global.config.ratelimit_config.updateMember.maxPerTimeFrame, global.config.ratelimit_config.updateMember.timeFrame), async (req, res) => {
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
        
        if (channel.type !== 3) {
            return res.status(403).json({
                code: 403,
                message: "Cannot remove members from this type of channel."
            });
        }

        if (channel.owner_id !== sender.id) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }
        
        const recipient = req.recipient;
        
        if (recipient == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown user"
            });
        }
        
        //Remove recipient
        channel.recipients = channel.recipients.filter(recip => recip.id !== recipient.id);
        
        if (!await global.database.updateChannelRecipients(channel.id, channel.recipients))
            throw "Failed to update recipients list in channel";
        
        //Notify everyone else
        await global.dispatcher.dispatchEventInPrivateChannel(channel, "CHANNEL_UPDATE", async function() {
            return globalUtils.personalizeChannelObject(this.socket, channel);
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

router.delete("/:channelid", channelMiddleware, guildPermissionsMiddleware("MANAGE_CHANNELS"), rateLimitMiddleware(global.config.ratelimit_config.deleteChannel.maxPerTimeFrame, global.config.ratelimit_config.deleteChannel.timeFrame), async (req, res) => {
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

        if (channel.type !== 3 && channel.type !== 1) {
            if (req.guild && req.guild.channels.length === 1) {
                return res.status(400).json({
                    code: 400,
                    message: "You cannot delete all channels in this server"
                });
            }
        }

        if (channel.type == 1 || channel.type == 3) {
            //Leaving a private channel
            let userPrivateChannels = await global.database.getPrivateChannels(sender.id);

            if (!userPrivateChannels) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Channel"
                });
            }

            //TODO: Elegant but inefficient
            let newUserPrivateChannels = userPrivateChannels.filter(id => id != channel.id);

            if (newUserPrivateChannels.length == userPrivateChannels.length) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Channel"
                });
            }

            let tryUpdate = await global.database.setPrivateChannels(sender.id, newUserPrivateChannels);

            if (!tryUpdate) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
            
            await global.dispatcher.dispatchEventTo(sender.id, "CHANNEL_DELETE", {
                id: channel.id,
                guild_id: null
            });
            
            if (channel.type == 3) {
                //Remove user from recipients list
                if (!await global.database.updateChannelRecipients(channel.id, channel.recipients))
                    throw "Failed to update recipients list in channel";

                await global.dispatcher.dispatchEventInPrivateChannel(channel, "CHANNEL_UPDATE", async function() {
                    return globalUtils.personalizeChannelObject(this.socket, channel);
                });
            }

        } else {
            //Deleting a guild channel
            if (req.params.channelid == req.params.guildid) {
                //TODO: Allow on 2018+ guilds
                return res.status(403).json({
                    code: 403,
                    message: "The main channel cannot be deleted."
                });
            }

            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "CHANNEL_DELETE", {
                id: channel.id,
                guild_id: channel.guild_id
            });

            if (!await global.database.deleteChannel(channel.id)) {
                await globalUtils.unavailableGuild(req.guild, "Something went wrong while deleting a channel");

                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
        }

        return res.status(204).send();
    } catch(error) {
        logText(error, "error");
        
        if (req.guild)
            
        
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.use("/:channelid/pins", pins);

module.exports = router;
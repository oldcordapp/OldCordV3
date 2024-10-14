const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const { channelPermissionsMiddleware, rateLimitMiddleware, instanceMiddleware } = require('../helpers/middlewares');
const fs = require('fs');
const multer = require('multer');
const Jimp = require('jimp');
const Snowflake = require('../helpers/snowflake');
const reactions = require('./reactions');
const path = require('path');

const upload = multer();
const router = express.Router({ mergeParams: true });

router.param('messageid', async (req, res, next, messageid) => {
    req.message = await global.database.getMessageById(messageid);
    
    next();
});

router.use("/:messageid/reactions", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), reactions);

function handleJsonAndMultipart(req, res, next) {
    const contentType = req.headers['content-type'];
    if (contentType && contentType.startsWith('multipart/form-data')) {
        upload.single('file')(req, res, next);
    } else {
        express.json()(req, res, next);
    }
}

router.get("/", channelPermissionsMiddleware("READ_MESSAGE_HISTORY"), async (req, res) => {
    try {
        const creator = req.account;

        if (creator == null) {
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

        let limit = parseInt(req.query.limit) || 200;

        if (limit > 200) {
            limit = 200;
        }

        let includeReactions = req.guild && !req.guild.exclusions.includes("reactions");

        let messages = await global.database.getChannelMessages(channel.id, limit, req.query.before, req.query.after, includeReactions);

        for(var msg of messages) {
            if (msg.id === '1279218211430105089') {
                msg.content = msg.content.replace("[YEAR]", req.client_build_date.getFullYear());
            }

            if (msg.reactions) {
                for(var reaction of msg.reactions) {
                    reaction.me = reaction.user_ids.includes(creator.id);
                        
                    delete reaction.user_ids;
                }
            }
        }

        return res.status(200).json(messages);
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.post("/", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), handleJsonAndMultipart, channelPermissionsMiddleware("SEND_MESSAGES"), rateLimitMiddleware(global.config.ratelimit_config.sendMessage.maxPerTimeFrame, global.config.ratelimit_config.sendMessage.timeFrame), async (req, res) => {
    try {
        const author = req.account;

        if (author == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }
        
        const account = author;

        if (req.channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let embeds = [];  //So... discord removed the ability for users to create embeds in their messages way back in like 2020, killing the whole motive of self bots, but here at Oldcord, we don't care - just don't abuse our API.

        if (req.body.embeds) {
            for(var embed of req.body.embeds) {
                let embedObj = {
                    type: "rich",
                    color: embed.color ?? 7506394
                };

                if (embed.title) {
                    embedObj.title = embed.title;
                }

                if (embed.description) {
                    embedObj.description = embed.description;
                }

                if (embed.author) {
                    embedObj.author = {
                        icon_url: embed.author.icon_url ? `/proxy?url=${embed.author.icon_url}` : null,
                        name: embed.author.name ?? null,
                        proxy_icon_url: embed.author.icon_url ? `/proxy?url=${embed.author.icon_url}` : null,
                        url: embed.author.url ?? null
                    }
                }

                if (embed.fields) {
                    embedObj.fields = embed.fields;
                }

                embeds.push(embedObj);
            }
        }

        const mentions_data = globalUtils.parseMentions(req.body.content);

        if ((mentions_data.mention_everyone || mentions_data.mention_here) && !await global.permissions.hasChannelPermissionTo(req.channel, req.guild, author.id, "MENTION_EVERYONE")) {
            mentions_data.mention_everyone = false;
            mentions_data.mention_here = false;
        }
        
        //Coerce tts field to boolean
        req.body.tts = req.body.tts === true || req.body.tts === "true";

        if (!req.channel.recipients) {
            if (!req.guild) {
                return res.status(403).json({
                    code: 403,
                    message: "Unknown channel"
                });
            }
            
            if (!req.channel.guild_id) {
                return res.status(403).json({
                    code: 403,
                    message: "Unknown channel"
                });
            }
        }

        if (req.channel.recipients) {
            //DM/Group channel rules
            
            //Disable @everyone and @here for DMs and groups
            mentions_data.mention_everyone = false;
            mentions_data.mention_here = false;
            
            if (req.channel.type !== 1 && req.channel.type !== 3) {
                //Not a DM channel or group channel
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Channel"
                });
            }

            if (req.channel.type == 1) {
                //DM channel
                
                //Need a complete user object for the relationships
                let recipientID = req.channel.recipients[req.channel.recipients[0].id == author.id ? 1: 0].id;
                let recipient = await global.database.getAccountByUserId(recipientID);

                if (!recipient) {
                    return res.status(404).json({
                        code: 404,
                        message: "Unknown Channel"
                    });
                }

                let ourFriends = account.relationships;
                let theirFriends = recipient.relationships;
                let ourRelationshipState = ourFriends.find(x => x.user.id == recipient.id);
                let theirRelationshipState = theirFriends.find(x => x.user.id == account.id);

                if (!ourRelationshipState) {
                    ourFriends.push({
                        id: recipient.id,
                        type: 0,
                        user: globalUtils.miniUserObject(recipient)
                    });

                    ourRelationshipState = ourFriends.find(x => x.user.id == recipient.id);
                }

                if (!theirRelationshipState) {
                    theirFriends.push({
                        id: account.id,
                        type: 0,
                        user: globalUtils.miniUserObject(account)
                    })

                    theirRelationshipState = theirFriends.find(x => x.user.id == account.id);
                }

                if (ourRelationshipState.type === 2) {
                    //we blocked them
                    
                    return res.status(403).json({
                        code: 403,
                        message: "You've blocked this user."
                    })
                }

                if (theirRelationshipState.type === 2) {
                    //they blocked us
                    
                    return res.status(403).json({
                        code: 403,
                        message: "You've been blocked by this user."
                    })
                }

                let guilds = await global.database.getUsersGuilds(recipient.id);
                let ourGuilds = await global.database.getUsersGuilds(account.id);
                
                let dmsOff = [];
        
                for(var guild of guilds) {
                    if (recipient.settings.restricted_guilds.includes(guild.id)) {
                        dmsOff.push(guild.id);
                    }
                }

                if (dmsOff.length === guilds.length && !globalUtils.areWeFriends(account, recipient)) {
                    return res.status(403).json({
                        code: 403,
                        message: "This user has direct messages turned off"
                    });
                }

                let shareMutualGuilds = false;

                for(var guild of guilds) {
                    if (ourGuilds.find(x => x.id === guild.id)) {
                        shareMutualGuilds = true;
                        break;
                    }
                }

                if (!shareMutualGuilds && !globalUtils.areWeFriends(account, recipient)) {
                    return res.status(403).json({
                        code: 403,
                        message: "You don't share any mutual servers with this user."
                    });
                }
            }
        } else {
            //Guild rules
            let canUseEmojis = !req.guild.exclusions.includes("custom_emoji");

            const emojiPattern = /<:[\w-]+:\d+>/g;

            const hasEmojiFormat = emojiPattern.test(req.body.content);

            if (hasEmojiFormat && !canUseEmojis) {
                return res.status(400).json({
                    code: 400,
                    message: "Custom emojis are disabled in this server due to its maximum support"
                });
            }

            if (req.body.tts && !await global.permissions.hasChannelPermissionTo(req.channel, req.guild, author.id, "SEND_TTS_MESSAGES")) {
                //Not allowed
                req.body.tts = false;
            }
        }
        
        let file_details = null;

        if (req.file) {
            if (req.file.size >= global.config.limits['attachments'].max_size) {
                return res.status(400).json({
                    code: 400,
                    message: `Message attachments cannot be larger than ${global.config.limits['attachments'].max_size} bytes.`
                }); 
            }

            file_details = {
                id: Snowflake.generate(),
                size: req.file.size,
            };

            file_details.name = globalUtils.replaceAll(req.file.originalname, ' ', '_').replace(/[^A-Za-z0-9_\-.()\[\]]/g, '');

            if (!file_details.name || file_details.name == "") {
                return res.status(403).json({
                    code: 403,
                    message: "Invalid filename"
                });
            }

            const channelDir = path.join('.', 'www_dynamic', 'attachments', req.channel.id);
            const attachmentDir = path.join(channelDir, file_details.id);
            const file_path = path.join(attachmentDir, file_details.name);
            
            file_details.url = `${globalUtils.config.secure ? 'https' : 'http'}://${globalUtils.config.base_url}${globalUtils.nonStandardPort ? `:${globalUtils.config.port}` : ''}/attachments/${req.channel.id}/${file_details.id}/${file_details.name}`;

            if (!fs.existsSync(attachmentDir)) {
                fs.mkdirSync(attachmentDir, { recursive: true });
            }

            fs.writeFileSync(file_path, req.file.buffer);
            
            try {
                const image = await Jimp.read(req.file.buffer);
                if (image) {
                    file_details.width = image.getWidth();
                    file_details.height = image.getHeight();
                }
            } catch {}
        }

        //Write message
        const message = await global.database.createMessage(req.guild ? req.guild.id : null, req.channel.id, author.id, req.body.content, req.body.nonce, file_details, req.body.tts, mentions_data, null, embeds);

        if (!message)
            throw "Message creation failed";
        
        //Dispatch to correct recipients(s) in DM, group, or guild
        if (req.channel.recipients) {
            await globalUtils.pingPrivateChannel(req.channel);
            await global.dispatcher.dispatchEventInPrivateChannel(req.channel, "MESSAGE_CREATE", message);
        } else {
            await global.dispatcher.dispatchEventInChannel(req.guild, req.channel.id, "MESSAGE_CREATE", message);
        }

        //Acknowledge immediately to author
        const tryAck = await global.database.acknowledgeMessage(author.id, req.channel.id, message.id, 0);

        if (!tryAck)
            throw "Message acknowledgement failed";

        await global.dispatcher.dispatchEventTo(author.id, "MESSAGE_ACK", {
            channel_id: req.channel.id,
            message_id: message.id
        });

        return res.status(200).json(message);
        
    }  catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.delete("/:messageid", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), channelPermissionsMiddleware("MANAGE_MESSAGES"), rateLimitMiddleware(global.config.ratelimit_config.deleteMessage.maxPerTimeFrame, global.config.ratelimit_config.deleteMessage.timeFrame), async (req, res) => {
    try {
        const guy = req.account;

        if (guy == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const message = req.message;

        if (message == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Message"
            });
        }

        const channel = req.channel;

        if (channel == null || (!channel.recipients && !channel.guild_id)) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        if (channel.recipients && message.author.id != guy.id) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        if (!await global.database.deleteMessage(req.params.messageid))
            throw "Message deletion failed";

        const payload = {
            id: req.params.messageid,
            guild_id: channel.guild_id,
            channel_id: req.params.channelid
        };

        if (channel.recipients)
            await global.dispatcher.dispatchEventInPrivateChannel(channel, "MESSAGE_DELETE", payload);
        else
            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "MESSAGE_DELETE", payload);
    
        return res.status(204).send();
        
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:messageid", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), rateLimitMiddleware(global.config.ratelimit_config.updateMessage.maxPerTimeFrame, global.config.ratelimit_config.updateMessage.timeFrame), async (req, res) => {
    try {
        if (req.body.content && req.body.content == "") {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }
        
        const caller = req.account;

        if (caller == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let message = req.message;

        if (message == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Message"
            });
        }

        const channel = req.channel;

        if (channel == null)
            throw "Message update in null channel";

        if (!channel.recipients && !channel.guild_id) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        if (message.author.id != caller.id) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        //TODO:
        //FIXME: this needs to use globalUtils.parseMentions
        if (req.body.content && req.body.content.includes("@everyone")) {
            let pCheck = await global.permissions.hasChannelPermissionTo(req.channel, req.guild, message.author.id, "MENTION_EVERYONE");

            if (!pCheck) {
                req.body.content = req.body.content.replace(/@everyone/g, "");
            }
        }

        const update = await global.database.updateMessage(message.id, req.body.content);

        if (!update)
            throw "Message update failed";

        message = await global.database.getMessageById(req.params.messageid);

        if (message == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Message"
            });
        }

        if (channel.recipients)
            await global.dispatcher.dispatchEventInPrivateChannel(channel, "MESSAGE_UPDATE", message);
        else
            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "MESSAGE_UPDATE", message);

        return res.status(204).send();
        
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/:messageid/ack", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), rateLimitMiddleware(global.config.ratelimit_config.ackMessage.maxPerTimeFrame, global.config.ratelimit_config.ackMessage.timeFrame), async (req, res) => {
    try {
        const guy = req.account;

        if (guy == null || !guy.token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const message = req.message;

        if (message == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Message"
            });
        }

        const channel = req.channel;

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let msgAlreadyAcked = await global.database.isMessageAcked(guy.id, channel.id, message.id);

        if (msgAlreadyAcked) {
            return res.status(200).json({
                token: globalUtils.generateToken(guy.id, globalUtils.generateString(20))
            });
        }

        let tryAck = await global.database.acknowledgeMessage(guy.id, channel.id, message.id, 0);

        if (!tryAck)
            throw "Message acknowledgement failed";

        await global.dispatcher.dispatchEventTo(guy.id, "MESSAGE_ACK", {
            channel_id: channel.id,
            message_id: message.id
        });
        
        return res.status(200).json({
            token: globalUtils.generateToken(guy.id, globalUtils.generateString(20))
        })
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
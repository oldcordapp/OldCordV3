const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const { channelPermissionsMiddleware, rateLimitMiddleware } = require('../helpers/middlewares');
const fs = require('fs');
const multer = require('multer');
const sizeOf = require('image-size');
const Snowflake = require('../helpers/snowflake');
const reactions = require('./reactions');

const upload = multer();
const router = express.Router({ mergeParams: true });

router.param('messageid', async (req, res, next, messageid) => {
    req.message = await global.database.getMessageById(messageid);

    next();
});

router.use("/:messageid/reactions", reactions);

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

router.post("/", handleJsonAndMultipart, channelPermissionsMiddleware("SEND_MESSAGES"), rateLimitMiddleware(5, 1000 * 10), rateLimitMiddleware(1000, 1000 * 60 * 60), async (req, res) => {
    try {
        const creator = req.account;

        if (creator == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const account = creator;

        const channel = req.channel;

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let finalContent = req.body.content;

        if (req.body.mentions && req.body.mentions.length > 0) {
            const mentions = req.body.mentions;
            
            for(let mention of mentions) {
                const user = await global.database.getAccountByUserId(mention);

                if (user != null) {
                    finalContent = finalContent.replace(`@${user.username}`, `<@${user.id}>`);
                }
            }

            req.body.content = finalContent;
        }

        let mention_everyone = false;

        if (finalContent && (finalContent.includes("@everyone") || finalContent.includes("@here"))) {
            let pCheck = await global.permissions.hasChannelPermissionTo(req.channel, req.guild, creator.id, "MENTION_EVERYONE");

            mention_everyone = pCheck;
        }

        let file_details = null;
        let file_path = null;
        let attachment_id = null;

        if (req.file) {
            attachment_id = Snowflake.generate();

            let name = req.file.originalname.split(".")[0];
            let extension = req.file.originalname.split(".")[1];

            if (req.body.tts === "false") req.body.tts = false;
            else if (req.body.tts === "true") req.body.tts = true;

            if (req.guild) {
                if (req.body.tts) {
                    let canTts = await global.permissions.hasChannelPermissionTo(req.channel, req.guild, creator.id, "SEND_TTS_MESSAGES");
    
                    req.body.tts = canTts;
                }
            } else if (req.body.tts) req.body.tts = false; //how the fuck do you tts here?
            
            if (!fs.existsSync(`./user_assets/attachments/${channel.id}`)) {
                fs.mkdirSync(`./user_assets/attachments/${channel.id}`, { recursive: true });
            }

            if (!fs.existsSync(`./user_assets/attachments/${channel.id}/${attachment_id}`)) {
                fs.mkdirSync(`./user_assets/attachments/${channel.id}/${attachment_id}`, { recursive: true });
            }

            fs.writeFileSync(`./user_assets/attachments/${channel.id}/${attachment_id}/${name}.${extension}`, req.file.buffer);

            file_path = `./user_assets/attachments/${channel.id}/${attachment_id}/${name}.${extension}`;
        }

        if (channel.recipients || channel.recipient) {
            //handle dm channel case

            let isDM = false;

            if (channel.recipients) {
                channel.recipients = channel.recipients.filter(x => x.id !== account.id);

                isDM = channel.recipients.length === 1;
            }

            if (channel.recipient) {
                isDM = true;
            }

            if (isDM) {
                let channelId = null;

                if (channel.recipient && channel.recipient.id) {
                    channelId = channel.recipient.id;
                } else if (channel.recipients && channel.recipients.length === 1) {
                    channelId = channel.recipients[0].id;
                }

                let recipient = await global.database.getAccountByUserId(channelId);

                if (!recipient) {
                    return res.status(404).json({
                        code: 404,
                        message: "Unknown Channel"
                    });
                }

                let dmChannelUs = await global.database.getPrivateChannels(creator.id);
                let dmChannelThem = await global.database.getPrivateChannels(channelId);
                let dmChannelThey = dmChannelThem.find(x => x.recipients.find(y => y.id === creator.id));
                let dmChannelMe = dmChannelUs.find(x => x.recipients.find(y => y.id === channelId));

                if (!dmChannelMe.open) {
                    dmChannelMe.open = true;

                    await global.database.setPrivateChannels(creator.id, dmChannelUs); //save open state

                    //now this one becomes a bit trickier, because we have to account for the old and new system at the same time

                    let old_system = req.client_build_date.getFullYear() === 2015 || (req.client_build_date.getMonth() <= 8 && req.client_build_date.getFullYear() === 2016);

                    if (old_system) {
                        dmChannelMe.recipient = dmChannelMe.recipients[0];
                        
                        delete dmChannelMe.recipients;

                        await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", {
                            id: channel.id,
                            type: req.channel_types_are_ints ? 1 : "text",
                            recipient: dmChannelMe.recipient,
                            guild_id: null,
                            is_private: true
                        });
                    } else {
                        await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", {
                            id: channel.id,
                            type: req.channel_types_are_ints ? 1 : "text", //how? but whatever
                            recipients: dmChannelMe.recipients,
                            guild_id: null,
                        });
                    }
                }

                if (!dmChannelThey.open) {
                    dmChannelThey.open = true; //oh yeah baby its open now

                    await global.database.setPrivateChannels(channelId, dmChannelThem);

                    let sessions = global.userSessions.get(channelId);

                    let aliveSessions = sessions.filter(x => !x.dead && x.socket != null);

                    for(var session of aliveSessions) {
                        let client_build = session.socket.client_build_date;

                        if (!client_build) continue;

                        let old_system = client_build.getFullYear() === 2015 || (client_build.getMonth() <= 8 && client_build.getFullYear() === 2016);
                        
                        if (old_system) {
                            dmChannelThey.recipient = dmChannelThey.recipients[0];
                        
                            delete dmChannelThey.recipients;

                            session.dispatch("CHANNEL_CREATE", {
                                id: channel.id,
                                type: req.channel_types_are_ints ? 1 : "text",
                                recipient: dmChannelThey.recipient,
                                guild_id: null,
                                is_private: true
                            })
                        } else {
                            session.dispatch("CHANNEL_CREATE", {
                                id: channel.id,
                                type: req.channel_types_are_ints ? 1 : "text", //how? but whatever
                                recipients: dmChannelThey.recipients,
                                guild_id: null
                            });
                        }
                    }
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

                let user = recipient;
                let guilds = await global.database.getUsersGuilds(user.id);
                let ourGuilds = await global.database.getUsersGuilds(account.id);
                
                let dmsOff = [];
        
                for(var guild of guilds) {
                    if (user.settings.restricted_guilds.includes(guild.id)) {
                        dmsOff.push(guild.id);
                    }
                }

                if (dmsOff.length === guilds.length && !globalUtils.areWeFriends(account, user)) {
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

                if (!shareMutualGuilds && !globalUtils.areWeFriends(account, user)) {
                    return res.status(403).json({
                        code: 403,
                        message: "You don't share any mutual servers with this user."
                    });
                }

                let createMessage = await global.database.createMessage(!channel.guild_id ? null : channel.guild_id, channel.id, creator.id, req.body.content, req.body.nonce, null, req.body.tts);
    
                if (!createMessage) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }
        
                await global.dispatcher.dispatchEventInDM(creator.id, recipient.id, "MESSAGE_CREATE", createMessage);
        
                let tryAck = await global.database.acknowledgeMessage(creator.id, channel.id, createMessage.id, 0);

                if (!tryAck) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }

                await global.dispatcher.dispatchEventTo(creator.id, "MESSAGE_ACK", {
                    channel_id: channel.id,
                    message_id: createMessage.id
                });

                return res.status(200).json(createMessage);
            } 

            if (channel.recipient || channel.type !== 3) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Channel"
                });
            }

            let createMessage = await global.database.createMessage(null, channel.id, creator.id, req.body.content, req.body.nonce, null, req.body.tts);

            if (!createMessage) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
    
            await global.dispatcher.dispatchEventInGroupChannel(channel, "MESSAGE_CREATE", createMessage);
    
            let tryAck = await global.database.acknowledgeMessage(creator.id, channel.id, createMessage.id, 0);

            if (!tryAck) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            await global.dispatcher.dispatchEventTo(creator.id, "MESSAGE_ACK", {
                channel_id: channel.id,
                message_id: createMessage.id
            });

            return res.status(200).json(createMessage);
        }

        if (!channel.guild_id || !req.guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        let canUseEmojis = !req.guild.exclusions.includes("custom_emoji");

        const emojiPattern = /<:[\w-]+:\d+>/g;

        const hasEmojiFormat = emojiPattern.test(req.body.content);

        if (hasEmojiFormat && !canUseEmojis) {
            return res.status(400).json({
                code: 400,
                message: "Custom emojis are disabled in this server due to its maximum support"
            });
        }

        if (req.body.tts === true) {
            let canTts = await global.permissions.hasChannelPermissionTo(req.channel, req.guild, creator.id, "SEND_TTS_MESSAGES");

            req.body.tts = canTts;
        } else if (!req.body.tts) req.body.tts = false;

        if (file_path != null) {
            sizeOf(file_path, async (err, dimensions) => {
                file_details = {
                    id: attachment_id,
                    size: req.file.size,
                    width: dimensions?.width,
                    height: dimensions?.height,
                    name: `${req.file.originalname.split(".")[0]}.${req.file.originalname.split(".")[1]}`,
                    extension: req.file.originalname.split(".")[1]
                };

                const createMessage = await global.database.createMessage(!channel.guild_id ? null : channel.guild_id, channel.id, creator.id, req.body.content, req.body.nonce, file_details, req.body.tts, ((channel.recipients || channel.recipient) ? false : mention_everyone));

                if (!createMessage) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }
        
                await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "MESSAGE_CREATE", createMessage);
        
                let tryAck = await global.database.acknowledgeMessage(creator.id, channel.id, createMessage.id, 0);

                if (!tryAck) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }
    
                await global.dispatcher.dispatchEventTo(creator.id, "MESSAGE_ACK", {
                    channel_id: channel.id,
                    message_id: createMessage.id
                });

                return res.status(200).json(createMessage);
            });
        } else {
            const createMessage = await global.database.createMessage(!channel.guild_id ? null : channel.guild_id, channel.id, creator.id, req.body.content, req.body.nonce, file_details, req.body.tts, ((channel.recipients || channel.recipient) ? false : mention_everyone));

            if (!createMessage) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "MESSAGE_CREATE", createMessage);

            let tryAck = await global.database.acknowledgeMessage(creator.id, channel.id, createMessage.id, 0);

            if (!tryAck) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            await global.dispatcher.dispatchEventTo(creator.id, "MESSAGE_ACK", {
                channel_id: channel.id,
                message_id: createMessage.id
            });
        
            return res.status(200).json(createMessage);
        }
    }  catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.delete("/:messageid", channelPermissionsMiddleware("MANAGE_MESSAGES"), rateLimitMiddleware(5, 1000 * 10), rateLimitMiddleware(1000, 1000 * 60 * 60, true), async (req, res) => {
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

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        if (channel.recipient || channel.recipients) {
            if (message.author.id != guy.id) {
                return res.status(403).json({
                    code: 403,
                    message: "Missing Permissions"
                });
            }
    
            const del = await global.database.deleteMessage(req.params.messageid);
    
            if (!del) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            await global.dispatcher.dispatchEventInDM(guy.id, channel.recipients ? channel.recipients[0].id : channel.recipient.id, "MESSAGE_DELETE", {
                id: req.params.messageid,
                guild_id: channel.guild_id,
                channel_id: req.params.channelid
            });
    
            return res.status(204).send();
        } else {
            if (!channel.guild_id) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Channel"
                });
            }
    
            const del = await global.database.deleteMessage(req.params.messageid);
    
            if (!del) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
    
            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "MESSAGE_DELETE", {
                id: req.params.messageid,
                guild_id: channel.guild_id,
                channel_id: req.params.channelid
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

router.patch("/:messageid", rateLimitMiddleware(5, 1000 * 10, true), rateLimitMiddleware(1000, 1000 * 60 * 60), async (req, res) => {
    try {
        if (req.body.content && req.body.content == "") {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }
        
        const guy = req.account;

        if (guy == null) {
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

        if (channel == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        if (channel.recipient || channel.recipients) {
            if (message.author.id != guy.id) {
                return res.status(403).json({
                    code: 403,
                    message: "Missing Permissions"
                });
            }

            let finalContent = req.body.content;

            if (req.body.mentions && req.body.mentions.length > 0) {
                const mentions = req.body.mentions;
                
                for(let mention of mentions) {
                    const user = await global.database.getAccountByUserId(mention);

                    if (user != null) {
                        finalContent = finalContent.replace(`@${user.username}`, `<@${user.id}>`);
                    }
                }

                req.body.content = finalContent;
            }

            if (finalContent && finalContent.includes("@everyone")) {
                let pCheck = await global.permissions.hasChannelPermissionTo(req.channel, req.guild, message.author.id, "MENTION_EVERYONE");

                if (!pCheck) {
                    finalContent = finalContent.replace(/@everyone/g, "");
                } 

                req.body.content = finalContent;
            }

            const update = await global.database.updateMessage(message.id, req.body.content);

            if (!update) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            message = await global.database.getMessageById(req.params.messageid);

            if (message == null) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Message"
                });
            }

            await global.dispatcher.dispatchEventInDM(guy.id, channel.recipients ? channel.recipients[0].id : channel.recipient.id, "MESSAGE_UPDATE", message);

            return res.status(204).send();
        } else {
            if (!channel.guild_id) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Channel"
                });
            }
            
            if (message.author.id != guy.id) {
                return res.status(403).json({
                    code: 403,
                    message: "Missing Permissions"
                });
            }

            let finalContent = req.body.content;

            if (req.body.mentions && req.body.mentions.length > 0) {
                const mentions= req.body.mentions;
                
                for(let mention of mentions) {
                    const user = await global.database.getAccountByUserId(mention);

                    if (user != null) {
                        finalContent = finalContent.replace(`@${user.username}`, `<@${user.id}>`);
                    }
                }

                req.body.content = finalContent;
            }

            if (finalContent && finalContent.includes("@everyone")) {
                let pCheck = await global.permissions.hasChannelPermissionTo(req.channel, req.guild, message.author.id, "MENTION_EVERYONE");

                if (!pCheck) {
                    finalContent = finalContent.replace(/@everyone/g, "");
                } 

                req.body.content = finalContent;
            }

            const update = await global.database.updateMessage(message.id, req.body.content);

            if (!update) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            message = await global.database.getMessageById(req.params.messageid);

            if (message == null) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Message"
                });
            }

            await global.dispatcher.dispatchEventInChannel(req.guild, channel.id, "MESSAGE_UPDATE", message);

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

router.post("/:messageid/ack", rateLimitMiddleware(5, 1000 * 10), rateLimitMiddleware(1000, 1000 * 60 * 60), async (req, res) => {
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

        let tryAck = await global.database.acknowledgeMessage(guy.id, channel.id, message.id, 0);

        if (!tryAck) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

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
const express = require('express');
const { logText } = require('../../helpers/logger');
const me = require('./me');
const globalUtils = require('../../helpers/globalutils');
const { rateLimitMiddleware, userMiddleware } = require('../../helpers/middlewares');

const router = express.Router();

router.param('userid', async (req, res, next, userid) => {
    req.user = await global.database.getAccountByUserId(userid);

    next();
});

router.use("/@me", me);

router.get("/:userid", userMiddleware, async (req, res) => {
    return res.status(200).json(globalUtils.miniUserObject(req.user));
});

//new dm system / group dm system
router.post("/:userid/channels", rateLimitMiddleware(global.config.ratelimit_config.createPrivateChannel.maxPerTimeFrame, global.config.ratelimit_config.createPrivateChannel.timeFrame), async (req, res) => {
    try {
        const account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let accountChannels = await global.database.getPrivateChannels(account.id);
        let recipients = [];
        let old_dm_sys = false;

        if (req.body.recipients) {
            recipients = req.body.recipients;
        }

        if (recipients.length === 0 && req.body.recipient_id) {
            //handle 2015 dm shit

            recipients = [
                req.body.recipient_id
            ];

            old_dm_sys = true;
        }

        if (recipients.length === 0) {
            return res.status(400).json({
                code: 400,
                message: "Valid recipients are required."
            });
        }

        if (recipients.length === 1) {
            let existingChannel = accountChannels.find(x => x.recipients && x.recipients.find(y => y.id === recipients[0]));

            if (existingChannel) {
                existingChannel.open = true;

                await global.database.setPrivateChannels(account.id, accountChannels); //its open now bucko

                if (old_dm_sys) {
                    existingChannel.type = req.channel_types_are_ints ? 1 : "text";
    
                    for(var recipient of existingChannel.recipients) {
                        delete recipient.owner;
                    }
    
                    existingChannel.recipient = existingChannel.recipients[0];

                    delete existingChannel.recipients;

                    existingChannel.is_private = true;
                } else {
                    for(var recipient of existingChannel.recipients) {
                        delete recipient.owner;
                    }
                }

                delete existingChannel.open;
    
                return res.status(200).json(existingChannel);
            }
        } 

        if (old_dm_sys) {
            //dont fucking care!!!

            let user = await global.database.getAccountByUserId(recipients[0]);

            if (user == null) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown User"
                });
            }

            let guilds = await global.database.getUsersGuilds(user.id);
            let ourGuilds = await global.database.getUsersGuilds(account.id);

            let shareMutualGuilds = false;

            for(var guild of guilds) {
                if (ourGuilds.find(x => x.id === guild.id)) {
                    shareMutualGuilds = true;
                    break;
                }
            }
    
            if (!shareMutualGuilds) {
                return res.status(400).json({
                    code: 400,
                    message: "Creating a new private channel failed"
                }); //???
            }
    
            let createPrivateChannel = await global.database.createPrivateChannel(account, [user], false);
    
            if (!createPrivateChannel) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
    
            createPrivateChannel.is_private = true;
            createPrivateChannel.type = req.channel_types_are_ints ? 1 : "text";

            await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", {
                guild_id: null,
                id: createPrivateChannel.id,
                recipient: createPrivateChannel.recipients.find(x => x.id !== account.id),
                is_private: true,
                type: createPrivateChannel.type
            });

            return res.status(200).json(createPrivateChannel);
        }

        let isDM = recipients.length === 1;

        if (!isDM) {
            //handle group jargain
            if (recipients.length > 9) {
                return res.status(400).json({
                    code: 400,
                    message: "Maximum number of members for group reached (10)."
                })
            }

            let handle_recipients = [];

            for(var recipient in recipients) {
                let userObject = await global.database.getAccountByUserId(recipient);

                if (!userObject) continue;

                if (globalUtils.areWeFriends(account, userObject)) {
                    handle_recipients.push(userObject);
                }
            }

            if (handle_recipients.length < 2) {
                return res.status(400).json({
                    code: 400,
                    message: "To start a group you need at least 2 or more people."
                })
            }

            let createPrivateChannel = await global.database.createPrivateChannel(account, handle_recipients, false);

            if (!createPrivateChannel) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", createPrivateChannel);

            return res.status(200).json(createPrivateChannel);
        }

        let user = await global.database.getAccountByUserId(recipients[0]);

        if (user == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });
        }

        const ourFriends = account.relationships;
        const theirFriends = user.relationships;
        const relationshipState = theirFriends.find(x => x.id === account.id);
        const ourRelationshipState = ourFriends.find(x => x.id === user.id);

        if (relationshipState && relationshipState.type !== 1) {
            if (relationshipState.type === 2) {
                return res.status(400).json({
                    code: 400,
                    message: "Creating a new private channel failed"
                }); 
            } //check if we're blocked
        }

        if (ourRelationshipState && ourRelationshipState.type === 2) {
            //we have blocked them? what are we doing?

            return res.status(400).json({
                code: 400,
                message: "Creating a new private channel failed"
            }); 
        }

        let guilds = await global.database.getUsersGuilds(user.id);
        let ourGuilds = await global.database.getUsersGuilds(account.id);
        
        let dmsOff = [];

        for(var guild of guilds) {
            if (user.settings.restricted_guilds.includes(guild.id)) {
                dmsOff.push(guild.id);
            }
        }

        if (dmsOff.length === guilds.length) {
            //they've turned off dms dude lol

            let createPrivateChannel = await global.database.createPrivateChannel(account, [user], true); //true because theyve turned off dms, so dont create the channel for them

            if (!createPrivateChannel) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", createPrivateChannel);

            return res.status(200).json(createPrivateChannel);
        }

        let shareMutualGuilds = false;

        for(var guild of guilds) {
            if (ourGuilds.find(x => x.id === guild.id)) {
                shareMutualGuilds = true;
                break;
            }
        }

        if (!shareMutualGuilds) {
            return res.status(400).json({
                code: 400,
                message: "Creating a new private channel failed"
            }); //???
        }

        let createPrivateChannel = await global.database.createPrivateChannel(account, [user], false);

        if (!createPrivateChannel) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", createPrivateChannel);

        return res.status(200).json(createPrivateChannel);
    } catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.get("/:userid/profile", userMiddleware, async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let user = req.user;

        if (!user) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });
        }

        let ret = {};

        let guilds = await global.database.getUsersGuilds(user.id);

        let sharedGuilds = guilds.filter(guild => guild.members != null && guild.members.length > 0 && guild.members.some(member => member.id === account.id));
        let mutualGuilds = [];

        for(var sharedGuild of sharedGuilds) {
            let id = sharedGuild.id;
            let member = sharedGuild.members.find(y => y.id == user.id);

            if (!member) continue;

            let nick = member.nick;

            mutualGuilds.push({
                id: id,
                nick: nick
            });
        }

        ret.mutual_guilds = mutualGuilds; 

        let ourFriends = account.relationships;
        let theirFriends = user.relationships;

        let sharedFriends = [];
        
        if (ourFriends.length > 0 && theirFriends.length > 0) {
            let theirFriendsSet = new Set(theirFriends.map(friend => friend.user.id && friend.type == 1));
        
            for (let ourFriend of ourFriends) {
                if (theirFriendsSet.has(ourFriend.user.id) && ourFriend.type == 1) {
                    sharedFriends.push(ourFriend.user);
                }
            }
        }

        ret.mutual_friends = sharedFriends.length > 0 ? sharedFriends : [];

        let connectedAccounts = await global.database.getConnectedAccounts(user.id);

        connectedAccounts = connectedAccounts.filter(x => x.visibility == 1);

        connectedAccounts.forEach(x => x = globalUtils.sanitizeObject(x, ['integrations', 'revoked', 'visibility']));

        ret.user = globalUtils.miniUserObject(user);
        ret.connected_accounts = connectedAccounts;
        ret.premium_since = new Date();

        return res.status(200).json(ret);
    }
    catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        }); 
    }
});

router.get("/:userid/relationships", userMiddleware, async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let user = req.user;

        if (!user) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });
        }

        let ourFriends = account.relationships;
        let theirFriends = user.relationships;

        let sharedFriends = [];

        for (var ourFriend of ourFriends) {
            for (var theirFriend of theirFriends) {
                if (theirFriend.user.id === ourFriend.user.id && theirFriend.type === 1 && ourFriend.type === 1) {
                    sharedFriends.push(theirFriend.user);
                }
            }
        }

        return res.status(200).json(sharedFriends);
    }
    catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        }); 
    }
});

module.exports = router;
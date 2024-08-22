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
router.post("/:userid/channels", rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let accountChannels = await global.database.getPrivateChannels(account.id);

        let recipients = req.body.recipients;

        if (recipients.length > 1) {
            //handle group dms

            return res.status(204).send();
        }

        let existingChannel = accountChannels.find(x => x.recipients && x.recipients.find(y => y.user.id === recipients[0]));

        if (existingChannel) {
            delete existingChannel.open;

            return res.status(200).json(existingChannel);
        }
    
        const user = await global.database.getAccountByUserId(req.body.recipients[0]);

        if (user == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });
        }

        const ourFriends = await global.database.getRelationshipsByUserId(account.id);
        const theirFriends = await global.database.getRelationshipsByUserId(user.id);
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

            let createPrivateChannel = await global.database.createPrivateChannel(account.id, [user.id], true); //true because theyve turned off dms, so dont create the channel for them

            await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", {
                id: account.id,
                name: "",
                topic: "",
                position: 0,
                type: 1,
                recipients: [
                    globalUtils.miniUserObject(user)
                ], //Since we're in a mid 2016 - 2017+ route, we can assume to use recipients here as otherwise the user doesnt know what the fuck theyre doing
                guild_id: null,
                is_private: true,
                permission_overwrites: []
            });

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

        let createPrivateChannel = await global.database.createPrivateChannel(account.id, [user.id], false);

        await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", {
            id: account.id,
            name: "",
            topic: "",
            position: 0,
            type: 1,
            recipients: [
                globalUtils.miniUserObject(user)
            ], //Since we're in a mid 2016 - 2017+ route, we can assume to use recipients here as otherwise the user doesnt know what the fuck theyre doing
            guild_id: null,
            is_private: true,
            permission_overwrites: []
        });

        return res.status(200).json(createPrivateChannel);
    } catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

/*
router.post("/:userid/channels", rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const user = await global.database.getAccountByUserId(req.body.recipient_id);

        if (user == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });
        }

        if (user.id == account.id) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        const dm_channels = await global.database.getDMChannels(account.id);
        const openedAlready = dm_channels.find(x => x.receiver_of_channel_id == user.id || x.author_of_channel_id == user.id);

        if (openedAlready) {
            if (openedAlready.is_closed) {
                await global.database.openDMChannel(openedAlready.id);

                await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", {
                    id: openedAlready.id,
                    name: "",
                    topic: "",
                    position: 0,
                    type: req.channel_types_are_ints ? 1 : "text",
                    recipient: globalUtils.miniUserObject(user),
                    guild_id: null,
                    is_private: true,
                    permission_overwrites: []
                });
        
                await global.dispatcher.dispatchEventTo(user.id, "CHANNEL_CREATE", {
                    id: openedAlready.id,
                    name: "",
                    topic: "",
                    position: 0,
                    type: req.channel_types_are_ints ? 1 : "text",
                    recipient: globalUtils.miniUserObject(account),
                    guild_id: null,
                    is_private: true,
                    permission_overwrites: []
                });
            }

            return res.status(200).json({
                id: openedAlready.id,
                name: "",
                topic: "",
                position: 0,
                type: req.channel_types_are_ints ? 1 : "text",
                recipient: globalUtils.miniUserObject(user),
                guild_id: null,
                is_private: true,
                permission_overwrites: []
            });
        }

        const theirguilds = await global.database.getUsersGuilds(user.id);
        const myguilds = await global.database.getUsersGuilds(account.id);

        let share = false;

        for (var their of theirguilds) {
            if (their.members != null && their.members.length > 0) {
                const theirmembers = their.members;

                if (theirmembers.filter(x => x.id == account.id).length > 0) {
                    share = true;
                }
            }
        }

        for (var mine of myguilds) {
            if (mine.members != null && mine.members.length > 0) {
                const mymembers = mine.members;

                if (mymembers.filter(x => x.id == user.id).length > 0) {
                    share = true;
                }
            }
        }

        if (!share) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        const regularChannel = await global.database.createChannel(null, "", req.channel_types_are_ints ? 0 : "text", 0);

        if (!regularChannel) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const channel = await global.database.createDMChannel(account.id, user.id);

        if (channel == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventTo(account.id, "CHANNEL_CREATE", {
            id: channel.id,
            name: "",
            topic: "",
            position: 0,
            type: req.channel_types_are_ints ? 1 : "text",
            recipient: globalUtils.miniUserObject(user),
            guild_id: null,
            is_private: true,
            permission_overwrites: []
        });

        await global.dispatcher.dispatchEventTo(user.id, "CHANNEL_CREATE", {
            id: channel.id,
            name: "",
            topic: "",
            position: 0,
            type: req.channel_types_are_ints ? 1 : "text",
            recipient: globalUtils.miniUserObject(account),
            guild_id: null,
            is_private: true,
            permission_overwrites: []
        });

        return res.status(200).json({
            id: channel.id,
            name: "",
            topic: "",
            position: 0,
            recipient: {
                id: user.id
            },
            type: req.channel_types_are_ints ? 1 : "text",
            guild_id: null,
            is_private: true,
            permission_overwrites: []
        });
    }
    catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});
*/

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

        let ourFriends = await global.database.getRelationshipsByUserId(account.id);
        let theirFriends = await global.database.getRelationshipsByUserId(user.id);

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

        ret.user = user;
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

        let ourFriends = await global.database.getRelationshipsByUserId(account.id);
        let theirFriends = await global.database.getRelationshipsByUserId(user.id);

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
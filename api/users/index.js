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
    let return_user = req.user;

    delete return_user.email;
    delete return_user.password;
    delete return_user.token;
    delete return_user.settings;
    delete return_user.verified;

    return res.status(200).json(req.user);
});

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
                    type: globalUtils.requiresIntsForChannelTypes(req.cookies['release_date']) ? 1 : "text",
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
                    type: globalUtils.requiresIntsForChannelTypes(req.cookies['release_date']) ? 1 : "text",
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
                type: globalUtils.requiresIntsForChannelTypes(req.cookies['release_date']) ? 1 : "text",
                recipient: globalUtils.miniUserObject(user, req.client_build),
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
            type: globalUtils.requiresIntsForChannelTypes(req.cookies['release_date']) ? 1 : "text",
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
            type: globalUtils.requiresIntsForChannelTypes(req.cookies['release_date']) ? 1 : "text",
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
            type: globalUtils.requiresIntsForChannelTypes(req.cookies['release_date']) ? 1 : "text",
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

        let return_user = user;

        delete return_user.email;
        delete return_user.password;
        delete return_user.token;
        delete return_user.settings;
        delete return_user.verified;

        let ret = {};

        let guilds = await global.database.getUsersGuilds(user.id, req.client_build);

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

        for(var connected of connectedAccounts) {
            delete connected.integrations;
            delete connected.revoked;
            delete connected.visibility;
        }

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
        
        if (ourFriends.length > 0 && theirFriends.length > 0) {
            let theirFriendsSet = new Set(theirFriends.map(friend => friend.user.id && friend.type == 1));
        
            for (let ourFriend of ourFriends) {
                if (theirFriendsSet.has(ourFriend.user.id) && ourFriend.type == 1) {
                    sharedFriends.push(ourFriend.user);
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
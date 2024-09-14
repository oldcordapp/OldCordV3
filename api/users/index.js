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
        
        let recipients = req.body.recipients;
        
        if (req.body.recipient_id) {
            recipients = [req.body.recipient_id];
        } else if (req.body.recipient) {
            recipients = [req.body.recipient];
        }
        
        if (!recipients) {
            return res.status(400).json({
                code: 400,
                message: "Valid recipients are required."
            });
        }
        
        if (recipients.length > 9) {
            return res.status(400).json({
                code: 400,
                message: "Too many recipients. (max: 10)"
            })
        }
        
        let validRecipientIDs = [];
        let map = {};

        validRecipientIDs.push(account.id);

        for(var recipient of recipients) {
            if (validRecipientIDs.includes(recipient))
                continue;
            
            let userObject = await global.database.getAccountByUserId(recipient);

            if (!userObject)
                continue;

            map[recipient] = userObject;

            validRecipientIDs.push(recipient);
        }
        
        let channel = null;
        let type = validRecipientIDs.length > 2 ? 3 : 1;

        if (type == 1)
            channel = await global.database.findPrivateChannel(account.id, validRecipientIDs[validRecipientIDs[0] == account.id ? 1 : 0]);

        if (type === 3) {
            for(var validRecipientId of validRecipientIDs) {
                let userObject = map[validRecipientId];

                if (!globalUtils.areWeFriends(account, userObject)) {
                    validRecipientIDs = validRecipientIDs.filter(x => x !== validRecipientId);

                    continue;
                }
            }

            type = validRecipientIDs.length > 2 ? 3 : 1;
        }

        channel ??= await global.database.createChannel(null, null, type, 0, validRecipientIDs, account.id);
        
        let pChannel = globalUtils.personalizeChannelObject(req, channel);
        
        if (type == 3)
            await globalUtils.pingPrivateChannel(channel);
        else
            await global.dispatcher.dispatchEventTo(account, "CHANNEL_CREATE", pChannel);
        
        return res.status(200).json(pChannel);

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

        let sharedFriends = [];

        if (!user.bot) {
            let ourFriends = account.relationships;
            let theirFriends = user.relationships;

            if (ourFriends.length > 0 && theirFriends.length > 0) {
                let theirFriendsSet = new Set(theirFriends.map(friend => friend.user.id && friend.type == 1));
            
                for (let ourFriend of ourFriends) {
                    if (theirFriendsSet.has(ourFriend.user.id) && ourFriend.type == 1) {
                        sharedFriends.push(ourFriend.user);
                    }
                }
            }
        }

        ret.mutual_friends = sharedFriends;

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

        if (!account || account.bot) {
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

        if (user.bot) {
            return res.status(200).json([]);
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
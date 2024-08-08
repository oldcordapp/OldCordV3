const express = require('express');
const fs = require('fs');
const { logText } = require('../../helpers/logger');
const me = require('./me');
const path = require('path');
const globalUtils = require('../../helpers/globalutils');
const { rateLimitMiddleware } = require('../../helpers/middlewares');
const dispatcher = require('../../helpers/dispatcher');

const router = express.Router();

router.param('userid', async (req, res, next, userid) => {
    req.user = await globalUtils.database.getAccountByUserId(userid);

    next();
});

router.use("/@me", me);

router.get("/:userid", async (req, res) => {
    let return_user = req.user;

    delete return_user.email;
    delete return_user.password;
    delete return_user.token;
    delete return_user.settings;
    delete return_user.verified;

    return res.status(200).json(req.user);
});

router.get("/:userid/avatars/:file", async (req, res) => {
    try {
        if (req.user == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });
        }

        const filePath = path.join(process.cwd(), 'user_assets', 'avatars', req.params.userid, req.params.file);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File not found");
        }

        return res.status(200).sendFile(filePath);
    }
    catch(error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.post("/:userid/channels", rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const account = req.account;

        if (!account) {
          return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
          });
        }

        const user = await globalUtils.database.getAccountByUserId(req.body.recipient_id);

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

        const dm_channels = await globalUtils.database.getDMChannels(account.id);
        const openedAlready = dm_channels.find(x => x.receiver_of_channel_id == user.id || x.author_of_channel_id == user.id);

        if (openedAlready) {
            if (openedAlready.is_closed) {
                await globalUtils.database.openDMChannel(openedAlready.id);

                dispatcher.dispatchEventTo(account.token, "CHANNEL_CREATE", {
                    id: openedAlready.id,
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
        
                dispatcher.dispatchEventTo(user.token, "CHANNEL_CREATE", {
                    id: openedAlready.id,
                    name: "",
                    topic: "",
                    position: 0,
                    recipient: {
                        id: account.id
                    },
                    type: globalUtils.requiresIntsForChannelTypes(req.cookies['release_date']) ? 1 : "text",
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
                recipient: {
                    id: user.id
                },
                type: globalUtils.requiresIntsForChannelTypes(req.cookies['release_date']) ? 1 : "text",
                guild_id: null,
                is_private: true,
                permission_overwrites: []
            });
        }

        const theirguilds = await globalUtils.database.getUsersGuilds(user.id);
        const myguilds = await globalUtils.database.getUsersGuilds(account.id);

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

        const channel = await globalUtils.database.createDMChannel(account.id, user.id);

        if (channel == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        dispatcher.dispatchEventTo(account.token, "CHANNEL_CREATE", {
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

        dispatcher.dispatchEventTo(user.token, "CHANNEL_CREATE", {
            id: channel.id,
            name: "",
            topic: "",
            position: 0,
            recipient: {
                id: account.id
            },
            type: globalUtils.requiresIntsForChannelTypes(req.cookies['release_date']) ? 1 : "text",
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
        logText(error.toString(), "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

module.exports = router;
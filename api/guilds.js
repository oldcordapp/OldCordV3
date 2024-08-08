const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const roles = require('./roles');
const members = require('./members');
const bans = require('./bans');
const { instanceMiddleware, rateLimitMiddleware, guildMiddleware, guildPermissionsMiddleware } = require('../helpers/middlewares');
const dispatcher = require('../helpers/dispatcher');
const { requiresIntsForChannelTypes } = require('../helpers/globalutils');

const router = express.Router();

router.param('guildid', async (req, _, next, guildid) => {
    req.guild = await globalUtils.database.getGuildById(guildid);

    next();
});

router.post("/", instanceMiddleware("NO_GUILD_CREATION"), rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        if (!req.body.name || req.body.name == "") {
            return res.status(400).json({
                name: "This field is required."
            })
        }

        if (req.body.name.length < 1 || req.body.name.length > 30) {
            return res.status(400).json({
                name: "Must be between 1 and 30 in length."
            })
        }

        const creator = req.account;

        if (!creator) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        if (!req.body.region) {
            return res.status(400).json({
                region: "A valid server region is required."
            });
        }

        const guild = await globalUtils.database.createGuild(creator.id, req.body.icon, req.body.name, req.body.region);

        if (guild == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        } else {
            if (!globalUtils.requiresIntsForChannelTypes(req.cookies['release_date'])) {
                guild.channels[0].type = "text";
            }

            dispatcher.dispatchEventTo(creator.token, "GUILD_CREATE", guild);

            return res.status(200).json(guild);
        }
      } catch (error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

//later 2016 guild deletion support - why the fuck do they do it like this?
router.post("/:guildid/delete", guildMiddleware, rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        const user = req.account;

        if (!user) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        if (guild.owner_id != user.id) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        await dispatcher.dispatchEventInGuild(guild.id, "GUILD_DELETE", {
            id: req.params.guildid
        });
        
        const del = await globalUtils.database.deleteGuild(guild.id);

        if (!del) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(204).send();
    } catch(error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.delete("/:guildid", guildMiddleware, rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        const user = req.account;

        if (!user) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        if (guild.owner_id == user.id) {
            await dispatcher.dispatchEventInGuild(guild.id, "GUILD_DELETE", {
                id: req.params.guildid
            });
            
            const del = await globalUtils.database.deleteGuild(guild.id);

            if (!del) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            return res.status(204).send();
        } else {
            const leave = await globalUtils.database.leaveGuild(user.id, guild.id);

            if (!leave) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            dispatcher.dispatchEventTo(user.token, "GUILD_DELETE", {
                id: req.params.guildid
            });

            await dispatcher.dispatchEventInGuild(req.params.guildid, "GUILD_MEMBER_REMOVE", {
                type: "leave",
                roles: [],
                user: {
                    username: user.username,
                    discriminator: user.discriminator,
                    id: user.id,
                    avatar: user.avatar
                },
                guild_id: req.params.guildid
            })

            return res.status(204).send();
        }
    } catch(error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.patch("/:guildid", guildMiddleware, guildPermissionsMiddleware("MANAGE_GUILD"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        if (req.body.name.length < 2 || req.body.name.length > 30) {
            return res.status(400).json({
                name: "Must be between 2 and 30 in length."
            })
        }

        const sender = req.account;

        if (sender == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        let what = req.guild;

        if (what == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }

        if (req.body.region && req.body.region != what.region) {
            return res.status(400).json({
                region: "Cannot change the oldcord year region for this server at this time. Try again later."
            });
        }

        const update = await globalUtils.database.updateGuild(req.params.guildid, req.body.afk_channel_id, req.body.afk_timeout, req.body.icon, req.body.name, req.body.region);

        if (!update) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        what = await globalUtils.database.getGuildById(req.params.guildid);

        if (what == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }

        await dispatcher.dispatchEventInGuild(req.params.guildid, "GUILD_UPDATE", what);

        return res.status(200).json(what);
      } catch (error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.get("/:guildid/prune", async (_, res) => {
    return res.status(200).json([]);
});

router.post("/:guildid/prune", async (_, res) => {
    return res.status(204).send();
});

router.get("/:guildid/embed", guildMiddleware, async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const widget = await globalUtils.database.getGuildWidget(req.params.guildid);

        if (widget == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }
        
        return res.status(200).json(widget);
      } catch (error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:guildid/embed", guildMiddleware, guildPermissionsMiddleware("MANAGE_GUILD"), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const update = await globalUtils.database.updateGuildWidget(req.params.guildid, req.body.channel_id, req.body.enabled);

        if (!update) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const widget = await globalUtils.database.getGuildWidget(req.params.guildid);

        if (widget == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }

        return res.status(200).json(widget);
      } catch (error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.get("/:guildid/invites", guildMiddleware, guildPermissionsMiddleware("MANAGE_GUILD"), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const invites = await globalUtils.database.getGuildInvites(req.params.guildid);

        return res.status(200).json(invites);
      } catch (error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/:guildid/channels", guildMiddleware, guildPermissionsMiddleware("MANAGE_CHANNELS"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const member = await globalUtils.database.getGuildMemberById(req.params.guildid, sender.id);

        if (member == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Member"
            });
        }

        let number_type = 0;

        if (typeof req.body.type === 'string') {
            number_type = req.body.type == "text" ? 0 : 1;
        } else number_type = req.body.type;

        const channel = await globalUtils.database.createChannel(req.params.guildid, req.body.name, number_type);

        if (channel == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        channel.type = typeof req.body.type === 'string' ? req.body.type : number_type;

        await dispatcher.dispatchEventInGuild(req.params.guildid, "CHANNEL_CREATE", channel);

        return res.status(200).json(channel);
    } catch(error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:guildid/channels", guildMiddleware, guildPermissionsMiddleware("MANAGE_CHANNELS"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        let ret = [];

        for(var shit of req.body) {
            var channel_id = shit.id;
            var position = shit.position;

            const channel = await globalUtils.database.getChannelById(channel_id)

            if (channel == null) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            channel.position = position;

            const outcome = await globalUtils.database.updateChannel(channel_id, channel);

            if (!outcome) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            if (!requiresIntsForChannelTypes(req.cookies['release_date'])) {
                channel.type = channel.type == 2 ? "voice" : "text";
            }

            ret.push(channel);

            await dispatcher.dispatchEventToAllPerms(channel.guild_id, channel.id, "READ_MESSAGE_HISTORY", "CHANNEL_UPDATE", channel);
        }

        return res.status(200).json(ret);
    } catch(error) {
        logText(error.toString(), "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.use("/:guildid/roles", roles);
router.use("/:guildid/members", members);
router.use("/:guildid/bans", bans);

router.get("/:guildid/regions", (_, res) => {
    return res.status(200).json(globalUtils.getRegions());
});

module.exports = router;
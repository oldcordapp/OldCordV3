const express = require('express');
const globalUtils = require('../../helpers/globalutils');
const dispatcher = global.dispatcher;
const { rateLimitMiddleware, guildMiddleware } = require('../../helpers/middlewares');
const { logText } = require('../../helpers/logger');
const router = express.Router();
const relationships = require('./relationships');

router.use("/relationships", relationships);

router.param('guildid', async (req, _, next, guildid) => {
    req.guild = await global.database.getGuildById(guildid);

    next();
});

router.get("/", async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    delete account.settings;
    delete account.token;
    delete account.password;
    
    return res.status(200).json(account);
  }
  catch (error) {
    logText(error, "error");

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    });
  }
});

router.patch("/", rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    delete account.settings;
    delete account.created_at;

    if (!req.body.avatar || req.body.avatar == "") req.body.avatar = null;

    if (!req.body.email || req.body.email == "") req.body.email = null;

    if (!req.body.new_password || req.body.new_password == "") req.body.new_password = null;

    if (!req.body.password || req.body.password == "") req.body.password = null;

    if (!req.body.username || req.body.username == "") req.body.username = null;

    let update_object = {
      avatar: req.body.avatar == ("" || null || undefined) ? null : req.body.avatar,
      email: req.body.email == ("" || null || undefined) ? null : req.body.email,
      new_password: req.body.new_password == ("" || null || undefined) ? null : req.body.new_password,
      password: req.body.password == ("" || null || undefined) ? null : req.body.password,
      username: req.body.username == ("" || null || undefined) ? null : req.body.username
    };

    if (update_object.email == account.email && update_object.new_password == null && update_object.password == null && update_object.username == account.username) {
       //avatar change

      const attemptToUpdateAvi = await global.database.updateAccount(update_object.avatar, account.email, account.username, null, null, null);

      if (attemptToUpdateAvi) {
        let account2 = await global.database.getAccountByEmail(account.email);

        if (account2 != null && account2.token) {
          delete account2.password;
          delete account2.settings;
          delete account2.created_at;

          await global.dispatcher.dispatchEventTo(account2.id, "USER_UPDATE", account2);

          await global.dispatcher.dispatchGuildMemberUpdateToAllTheirGuilds(account2.id, account2);

          return res.status(200).json(account2);
        }
      } else return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      });
    } else {
      if (update_object.password == null) {
        return res.status(400).json({
          code: 400,
          password: "This field is required"
        });
      }

      if (update_object.email == null) {
        return res.status(400).json({
          code: 400,
          email: "This field is required"
        });
      }

      if (update_object.username == null) {
        return res.status(400).json({
          code: 400,
          username: "This field is required"
        });
      }

      if (update_object.username.length < 2 || update_object.username.length > 32) {
        return res.status(400).json({
          code: 400,
          username: "Must be between 2 and 32 characters"
        });
      }

      if (update_object.email.length < 2 || update_object.email.length > 32) {
        return res.status(400).json({
          code: 400,
          email: "Must be between 2 and 32 characters"
        });
      }

      if (update_object.new_password && update_object.new_password.length > 64) {
        return res.status(400).json({
          code: 400,
          password: "Must be under 64 characters"
        });
      }

      const correctPassword = await global.database.doesThisMatchPassword(update_object.password, account.password);

        if (!correctPassword) {
          return res.status(400).json({
            code: 400,
            password: "Incorrect password"
          })
        }

      if ((update_object.email != account.email || update_object.username != account.username) || (update_object.email != account.email && update_object.username != account.username)) {
        const correctPassword = await global.database.doesThisMatchPassword(update_object.password, account.password);

        if (!correctPassword) {
          return res.status(400).json({
            code: 400,
            password: "Incorrect password"
          })
        }

        const update = await global.database.updateAccount(update_object.avatar, account.email, update_object.username, update_object.password, update_object.new_password, update_object.email);

        if (update) {
          let account2 = await global.database.getAccountByEmail(update_object.email);
  
          if (account2 != null && account2.token) {
            delete account2.settings;
            delete account2.password;
            delete account2.created_at;
  
            await global.dispatcher.dispatchEventTo(account2.id, "USER_UPDATE", account2);

            await global.dispatcher.dispatchGuildMemberUpdateToAllTheirGuilds(account2.id, account2);
            
            return res.status(200).json(account2);
          }
        }
      } else if (update_object.new_password != null) {
        const correctPassword = await global.database.doesThisMatchPassword(update_object.password, account.password);

        if (!correctPassword) {
          return res.status(400).json({
            code: 400,
            password: "Incorrect password"
          })
        }

        const update = await global.database.updateAccount(update_object.avatar, account.email, update_object.username, update_object.password, update_object.new_password, update_object.email);

        if (update) {
          let account2 = await global.database.getAccountByEmail(update_object.email);
  
          if (account2 != null && account2.token) {
            delete account2.settings;
            delete account2.password;
            delete account2.created_at;

            await global.dispatcher.dispatchEventTo(account2.id, "USER_UPDATE", account2);

            await global.dispatcher.dispatchGuildMemberUpdateToAllTheirGuilds(account2.id, account2);
            
            return res.status(200).json(account2);
          }
        }
      }
    }

    if (account != null) {
      delete account.password;
      delete account.settings;
      delete account.created_at;
    }

    return res.status(200).json(account);
  } catch (error) {
    logText(error, "error");

    console.log(error);

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    });
  }
});

router.patch("/settings", async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    let new_settings = account.settings;
    
    if (new_settings == null) {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      });
    }

    //"show_current_game":false,"inline_attachment_media":false,"inline_embed_media":true,"render_embeds":true,"render_reactions":true,"sync":true,"theme":"dark","enable_tts_command":true,"message_display_compact":false,"locale":"en-US","convert_emoticons":true,"restricted_guilds":[],"friend_source_flags":{"all":true},"developer_mode":true,"guild_positions":[],"detect_platform_accounts":false,"status":"offline"

    for (let key in req.body) {
        if (new_settings.hasOwnProperty(key)) {
          new_settings[key] = req.body[key];
        }
    }

    const attempt = await global.database.updateSettings(account.id, new_settings);

    if (attempt) {
      const settings = new_settings;

      await global.dispatcher.dispatchEventTo(account.id, "USER_SETTINGS_UPDATE", settings);

      return res.status(204).send();
    } else {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      })
    }
  } catch (error) {
    logText(error, "error");

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    })
  }
});

router.get("/connections", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let connectedAccounts = await global.database.getConnectedAccounts(account.id);

        return res.status(200).json(connectedAccounts);
    }
    catch(error) {
        logText(error, "error");

        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        })
    }
});

router.delete("/connections/:platform/:connectionid", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let platform = req.params.platform;
        let connectionid = req.params.connectionid;

        let config = globalUtils.config.integration_config.find(x => x.platform == platform);

        if (!config) {
            return res.status(400).json({
                code: 400,
                message: "This platform is not currently supported by Oldcord. Try again later."
            });
        }

        let connection = await global.database.getConnectionById(connectionid);

        if (connection == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Connection"
            });
        }

        let tryRemove = await global.database.removeConnectedAccount(connection.id);

        if (!tryRemove) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventTo(account.id, "USER_CONNECTIONS_UPDATE", {});

        let connectedAccounts = await global.database.getConnectedAccounts(account.id);

        return res.status(200).json(connectedAccounts);
    }
    catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        })
    }
});

router.patch("/connections/:platform/:connectionid", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let platform = req.params.platform;
        let connectionid = req.params.connectionid;

        let config = globalUtils.config.integration_config.find(x => x.platform == platform);

        if (!config) {
            return res.status(400).json({
                code: 400,
                message: "This platform is not currently supported by Oldcord. Try again later."
            });
        }

        let connection = await global.database.getConnectionById(connectionid);

        if (connection == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Connection"
            });
        }

        let tryUpdate = await global.database.updateConnectedAccount(connection.id, req.body.visibility == 1 ? true : false);

        if (!tryUpdate) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventTo(account.id, "USER_CONNECTIONS_UPDATE", {});

        let connectedAccounts = await global.database.getConnectedAccounts(account.id);

        return res.status(200).json(connectedAccounts);
    }
    catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        })
    }
});

//Leaving guilds in late 2016
router.delete("/guilds/:guildid", guildMiddleware, rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
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
                await global.dispatcher.dispatchEventInGuild(guild.id, "GUILD_DELETE", {
                    id: req.params.guildid
                });
                
                const del = await global.database.deleteGuild(guild.id);
    
                if (!del) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }
    
                return res.status(204).send();
            } else {
                const leave = await global.database.leaveGuild(user.id, guild.id);
    
                if (!leave) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }
    
                await global.dispatcher.dispatchEventTo(user.id, "GUILD_DELETE", {
                    id: req.params.guildid
                });
    
                await global.dispatcher.dispatchEventInGuild(req.params.guildid, "GUILD_MEMBER_REMOVE", {
                    type: "leave",
                    roles: [],
                    user: globalUtils.miniUserObject(user),
                    guild_id: req.params.guildid
                })
    
                return res.status(204).send();
            }
        } catch(error) {
            logText(error, "error");
        
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        })
    }
});

router.patch("/guilds/:guildid/settings", guildMiddleware, rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
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

        let usersGuildSettings = await global.database.getUsersGuildSettings(user.id);
        let guildSettings = usersGuildSettings.find(x => x.guild_id == guild.id);

        if (!guildSettings) {
            usersGuildSettings.push({
                guild_id: guild.id,
                muted: false,
                message_notifications: 2, //2 = Nothing, 1 = Only @mentions, 3 = All Messages
                suppress_everyone: false,
                mobile_push: false,
                channel_overrides: {} //channelid: message_notifications: 0 - (0 = all, 1 = mentions, 2 = nothing), muted: false (or true)
            });
        }

        guildSettings = usersGuildSettings.find(x => x.guild_id == guild.id);

        for (let key in req.body) {
            let value = req.body[key];

            if (guildSettings.hasOwnProperty(key)) {
                guildSettings[key] = value;
            }
        }

        let updateSettings = await global.database.setUsersGuildSettings(user.id, usersGuildSettings);

        if (!updateSettings) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        })
    }
});

module.exports = router;
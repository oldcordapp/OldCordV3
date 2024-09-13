const express = require('express');
const globalUtils = require('../../helpers/globalutils');
const { rateLimitMiddleware, guildMiddleware } = require('../../helpers/middlewares');
const { logText } = require('../../helpers/logger');
const router = express.Router();
const relationships = require('./relationships');
const Snowflake = require('../../helpers/snowflake');

router.use("/relationships", relationships);

router.param('userid', async (req, res, next, userid) => {
  req.user = await global.database.getAccountByUserId(userid);

  next();
});

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

    return res.status(200).json(globalUtils.sanitizeObject(account, ['settings', 'token', 'password', 'relationships', 'claimed']));
  }
  catch (error) {
    logText(error, "error");

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    });
  }
});

router.patch("/", rateLimitMiddleware(global.config.ratelimit_config.updateMe.maxPerTimeFrame, global.config.ratelimit_config.updateMe.timeFrame), async (req, res) => {
  try {
    let account = req.account;
    let originalAcc = account;

    if (!account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    if (account.bot) {
      if (req.body.username) {
        account.username = req.body.username;
      }

      if (account.username.length < 2 || account.username.length > 30) {
          return res.status(400).json({
            code: 400,
            username: "Must be between 2 and 30 characters"
          });
      }

      let goodUsername = globalUtils.checkUsername(account.username);

      if (goodUsername.code !== 200) {
          return res.status(goodUsername.code).json(goodUsername);
      }

      if (req.body.avatar === "") {
        account.avatar = null;
      }

      if (req.body.avatar) {
        account.avatar = req.body.avatar;
      }

      account = await global.database.updateBotUser(account);

      if (!account) {
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
      }

      return res.status(200).json(account);
    }

    // New accounts via invite (unclaimed account) have null email and null password.
    // By genius Discord engineering if they claim an account it does not use new_password it uses password.

    let update = {
      avatar: null,
      email: null,
      new_password: null,
      new_email: null,
      password: null,
      username: account.username,
      discriminator: account.discriminator
    };

    if (req.body.avatar) {
        update.avatar = req.body.avatar;
    }

    if (account.email) {
      if (req.body.email) {
        update.email = req.body.email;
      }
  
      if (update.email && update.email != account.email) {
        update.new_email = update.email;
        update.email = account.email;
      }
    } else {
      if (req.body.email) {
        update.new_email = req.body.email;
      }
    }

    if (account.password) {
      if (req.body.new_password) {
        update.new_password = req.body.new_password;
      }
  
      if (req.body.password) {
         update.password = req.body.password;
      }
    } else {
      if (req.body.password) {
        update.new_password = req.body.password;
      }
    }

    if (req.body.username) {
      update.username = req.body.username;
    }

    if (req.body.discriminator) {
      update.discriminator = req.body.discriminator;
    }

    if (update.email == account.email && update.new_password == null && update.password == null && update.username == account.username && update.discriminator == account.discriminator) {
       //avatar change
       
       let tryUpdate = await global.database.updateAccount(account.id, update.avatar, account.username, account.discriminator, null, null);

       if (tryUpdate !== 3 && tryUpdate !== 2) {
          return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
          });
       }

       let retAccount = await global.database.getAccountByEmail(account.email);

       if (!retAccount) {
          return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
          });
       }

       retAccount = globalUtils.sanitizeObject(retAccount, ['settings', 'created_at', 'password', 'relationships', 'claimed']);

       await global.dispatcher.dispatchEventTo(retAccount.id, "USER_UPDATE", retAccount);

       await global.dispatcher.dispatchGuildMemberUpdateToAllTheirGuilds(retAccount.id, retAccount);

       return res.status(200).json(retAccount);
    }

    if (account.password && update.password == null) {
      return res.status(400).json({
        code: 400,
        password: "This field is required"
      });
    }

    if (account.email && update.email == null) {
      return res.status(400).json({
        code: 400,
        email: "This field is required"
      });
    }

    if (update.username == null) {
      return res.status(400).json({
        code: 400,
        username: "This field is required"
      });
    }

    let discriminator = update.discriminator;
    
    if (isNaN(parseInt(discriminator)) || parseInt(discriminator) < 1 || parseInt(discriminator) > 9999 || discriminator.length !== 4) {
      return res.status(400).json({
        code: 400,
        username: "A valid discriminator is required."
      });
    }

    if (update.email && (update.email.length < 2 || update.email.length > 32)) {
      return res.status(400).json({
        code: 400,
        email: "Must be between 2 and 32 characters"
      });
    }

    if (update.new_email && (update.new_email.length < 2 || update.new_email.length > 32)) {
      return res.status(400).json({
        code: 400,
        email: "Must be between 2 and 32 characters"
      });
    }

    if (update.new_password && update.new_password.length > 64) {
      return res.status(400).json({
        code: 400,
        password: "Must be under 64 characters"
      });
    }

    let goodUsername = globalUtils.checkUsername(update.username);

    if (goodUsername.code !== 200) {
        return res.status(goodUsername.code).json(goodUsername);
    }

    if (update.password) {
      const correctPassword = await global.database.doesThisMatchPassword(update.password, account.password);

      if (!correctPassword) {
        return res.status(400).json({
          code: 400,
          password: "Incorrect password"
        })
      }
    }

    const attemptToUpdate = await global.database.updateAccount(account.id, update.avatar, update.username, update.discriminator, update.password, update.new_password, update.new_email);

    if (attemptToUpdate !== 3) {
      if (attemptToUpdate === -1) {
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
      }

      if (attemptToUpdate === 2) {
        return res.status(400).json({
          code: 400,
          password: "Incorrect password"
        }); //how?
      }

      if (attemptToUpdate === 0) {
        return res.status(400).json({
          code: 400,
          username: "Username#Tag combo already taken."
        });
      }

      if (attemptToUpdate === 1) {
        return res.status(400).json({
          code: 400,
          username: "Too many users have that username. Try another."
        });
      }
    }

    account = await global.database.getAccountByUserId(account.id);

    if (!account) {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      });
    }

    account = globalUtils.sanitizeObject(account, ['settings', 'created_at', 'password', 'relationships', 'claimed']);

    if (originalAcc.email != account.email) {
       account.verified = false;

       await global.database.unverifyEmail(account.id);
    } //unverify them as they need to uh verify with their new email thingimajig

    return res.status(200).json(account);
  } catch (error) {
    logText(error, "error");

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    });
  }
});

router.get("/settings", async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    return res.status(200).json(account.settings);
  } catch (error) {
    logText(error, "error");

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    });
  }
})

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

router.put("/notes/:userid", async (req, res) => {
  //updateNoteForUserId
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

    let new_notes = null;

    if (req.body.note && req.body.note.length > 1) {
      new_notes = req.body.note;
    }

    if (new_notes && new_notes.length > 250) {
      return res.status(400).json({
        code: 400,
        message: "User notes must be between 1 and 250 characters."
      });
    }

    let tryUpdate = await global.database.updateNoteForUserId(account.id, user.id, new_notes);

    if (!tryUpdate) {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      })
    }

    await global.dispatcher.dispatchEventTo(account.id, "USER_NOTE_UPDATE", {
      id: user.id,
      note: new_notes
    });

    return res.status(204).send();
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

        if (!account || account.bot) {
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

        if (!account || account.bot) {
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

        if (!account || account.bot) {
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
router.delete("/guilds/:guildid", guildMiddleware, rateLimitMiddleware(global.config.ratelimit_config.leaveGuild.maxPerTimeFrame, global.config.ratelimit_config.leaveGuild.timeFrame), async (req, res) => {
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
                await global.dispatcher.dispatchEventInGuild(guild, "GUILD_DELETE", {
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
    
                await global.dispatcher.dispatchEventInGuild(req.guild, "GUILD_MEMBER_REMOVE", {
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

router.patch("/guilds/:guildid/settings", guildMiddleware, rateLimitMiddleware(global.config.ratelimit_config.updateUsersGuildSettings.maxPerTimeFrame, global.config.ratelimit_config.updateUsersGuildSettings.timeFrame), async (req, res) => {
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
            //New guild settings object
            guildSettings = {
                guild_id: guild.id,
                muted: false,
                message_notifications: 2, //2 = Nothing, 1 = Only @mentions, 3 = All Messages
                suppress_everyone: false,
                mobile_push: false,
                channel_overrides: [] //channelid: message_notifications: 0 - (0 = all, 1 = mentions, 2 = nothing), muted: false (or true)
            };
            usersGuildSettings.push(guildSettings);
        }
        
        //Update guild settings
        function copyIfSetGuild(name) {
            if (req.body[name] !== undefined)
                guildSettings[name] = req.body[name];
        }
        
        copyIfSetGuild("muted");
        copyIfSetGuild("suppress_everyone");
        copyIfSetGuild("message_notifications");
        copyIfSetGuild("mobile_push");
        
        //Update channel overrides
        if (req.body.channel_overrides) {
            if (!guildSettings.channel_overrides || !Array.isArray(guildSettings.channel_overrides)) {
                //New channel overrides array for the guild (or old was corrupt)
                guildSettings.channel_overrides = [];
            }

            for (let [id, newChannelOverride] of Object.entries(req.body.channel_overrides)) {
                let channelOverride = guildSettings.channel_overrides.find(x => x.channel_id == id || x.channel_id == newChannelOverride.channel_id);

                if (!channelOverride) {
                    //New channel override
                    channelOverride = {
                        channel_id: id ?? newChannelOverride.channel_id,
                    };
                    guildSettings.channel_overrides.push(channelOverride);
                }

                //Update channel override settings
                function copyIfSetChannel(name) {
                    if (newChannelOverride[name] !== undefined)
                        channelOverride[name] = newChannelOverride[name];
                }

                copyIfSetChannel("muted");
                copyIfSetChannel("message_notifications");
            }
        }

        let updateSettings = await global.database.setUsersGuildSettings(user.id, usersGuildSettings);

        if (!updateSettings) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventTo(user.id, "USER_GUILD_SETTINGS_UPDATE", guildSettings);

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        })
    }
});

router.get("/mentions", async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
      return res.status(401).json({
          code: 401,
          message: "Unauthorized"
      });
    }

    let limit = req.query.limit ?? 25;
    let guild_id = req.query.guild_id ?? null;
    let include_roles = req.query.roles == "true" ?? false;
    let include_everyone_mentions = req.query.everyone == "true" ?? true;
    let before = req.query.before ?? null;

    if (!guild_id) {
      return res.status(200).json([]); //wtf why does this crash?
    }

    let recentMentions = await global.database.getRecentMentions(account.id, before, limit, include_roles, include_everyone_mentions, guild_id);

    return res.status(200).json(recentMentions);
  } catch (error) {
    logText(error, "error");

    return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
    })
  }
})

router.get("/activities", (req, res) => {
    return res.status(200).json([]);
});

router.get("/applications/:applicationid/entitlements", (req, res) => {
  return res.status(200).json([]);
})

router.get("/activities/statistics/applications", (req, res) => {
    return res.status(200).json([]);
});

router.get("/library", (req, res) => {
    return res.status(200).json([{
       id: "1279311572212178955",
       name: "Jason Citron Simulator 2024"
    }]);
});

router.get("/feed", (req, res) => {
    return res.status(200).json([]);
});

router.get("/feed/settings", (req, res) => {
    return res.status(200).json([]);
});

router.get("/entitlements/gifts", (req, res) => {
    return res.status(200).json([]);
});

router.get("/billing/payment-sources", (req, res) => {
    return res.status(200).json([]);
});

router.get("/affinities/users", (req, res) => {
    return res.status(200).json({
        user_affinities: [],
    });
});

router.get("/affinities/guilds", (req, res) => {
    return res.status(200).json({
        guild_affinities: [],
    });
});

module.exports = router;
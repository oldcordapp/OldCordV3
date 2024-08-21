const express = require('express');
const router = express.Router();
const globalUtils = require('../helpers/globalutils');
const instanceMiddleware = require('../helpers/middlewares').instanceMiddleware;
const rateLimitMiddleware = require("../helpers/middlewares").rateLimitMiddleware;
const { logText } = require('../helpers/logger');
const Snowflake = require('../helpers/snowflake');

const config = globalUtils.config;

router.post("/register", instanceMiddleware("NO_REGISTRATION"), rateLimitMiddleware(5, 1000 * 60 * 60), async (req, res) => {
    try {
        let release_date = req.client_build;

        if (!req.body.email && release_date == "june_12_2015") {
            req.body.email = `june_12_2015_app${globalUtils.generateString(10)}@oldcordrouter.com`
        } else if (!req.body.email) {
            return res.status(400).json({
                code: 400,
                email: "This field is required",
            });
        }

        if (!req.body.password && release_date == "june_12_2015") {
            req.body.password = globalUtils.generateString(20);
        } else if (!req.body.password) {
            return res.status(400).json({
                code: 400,
                password: "This field is required",
            });  
        }

        if (!req.body.username) {
            return res.status(400).json({
                code: 400,
                username: "This field is required",
            });
        }
        
        if (req.body.password.length > 64) {
            return res.status(400).json({
                code: 400,
                password: "Must be between under 64 characters",
            });
        }

        if (req.body.username.length < 2 || req.body.username.length > 32) {
            return res.status(400).json({
                code: 400,
                username: "Must be between 2 and 32 characters",
            });
        }

        const registrationAttempt = await global.database.createAccount(req.body.username, req.body.email, req.body.password);

        if ('reason' in registrationAttempt) {
            return res.status(400).json({
                code: 400,
                email: registrationAttempt.reason
            });
        }

        if (req.body.invite) {
            let code = req.body.invite;
            
            let invite = await global.database.getInvite(code);

            if (invite) {
                let account = await global.database.getAccountByToken(registrationAttempt.token);

                if (account == null) {
                    return res.status(401).json({
                        code: 401,
                        message: "Unauthorized"
                    });
                }

                let guild = await global.database.getGuildById(invite.guild.id);
                
                if (guild) {
                    await global.database.joinGuild(account.id, guild);

                    await global.dispatcher.dispatchEventTo(account.id, "GUILD_CREATE", guild);

                    await global.dispatcher.dispatchEventInGuild(guild, "GUILD_MEMBER_ADD", {
                        roles: [],
                        user: globalUtils.miniUserObject(account),
                        guild_id: invite.guild.id
                    });
    
                    await global.dispatcher.dispatchEventInGuild(guild, "PRESENCE_UPDATE", {
                        game_id: null,
                        status: "online",
                        user: globalUtils.miniUserObject(account),
                        guild_id: invite.guild.id
                    });
                }
            }
        }

        const autoJoinGuild = config.instance_flags.filter(x => x.toLowerCase().includes("autojoin:"));

        if (autoJoinGuild.length > 0) {
            let guildId = autoJoinGuild[0].split(':')[1];

            let guild = await global.database.getGuildById(guildId);

            if (guild != null) {
                let account = await global.database.getAccountByToken(registrationAttempt.token);

                if (account == null) {
                    return res.status(401).json({
                        code: 401,
                        message: "Unauthorized"
                    });
                }

                await global.database.joinGuild(account.id, guild);

                await global.dispatcher.dispatchEventTo(account.id, "GUILD_CREATE", guild);

                await global.dispatcher.dispatchEventInGuild(guild, "GUILD_MEMBER_ADD", {
                    roles: [],
                    user: globalUtils.miniUserObject(account),
                    guild_id: guildId
                });

                await global.dispatcher.dispatchEventInGuild(guild, "PRESENCE_UPDATE", {
                    game_id: null,
                    status: "online",
                    user: globalUtils.miniUserObject(account),
                    guild_id: guildId
                });
            }
        }

        return res.status(200).json({
            token: registrationAttempt.token,
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

router.post("/login", rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        if (!req.body.email) {
            return res.status(400).json({
                code: 400,
                email: "This field is required",
            });
        }
    
        if (!req.body.password) {
            return res.status(400).json({
                code: 400,
                password: "This field is required",
            });
        }
    
        const loginAttempt = await global.database.checkAccount(req.body.email, req.body.password);
    
        if ('disabled_until' in loginAttempt) {
            return res.status(400).json({
                code: 400,
                email: "This account has been disabled.",
            });
        }

        if ('reason' in loginAttempt) {
            return res.status(400).json({
                code: 400,
                email: loginAttempt.reason,
                password: loginAttempt.reason
            });
        }
    
        return res.status(200).json({
            token: loginAttempt.token,
        }); 
    } catch(error) {
        logText(error, "error");

        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/logout", (_, res) => {
    //to-do dispatch presence update offline to everyone here
    return res.status(204).send();
});

router.post("/forgot", async (req, res) => {
    try {
        let email = req.body.email;

        if (!email) {
            return res.status(400).json({
                code: 400,
                email: "This field is required.",
            });
        }

        let account = await global.database.getAccountByEmail(email);

        if (!account) {
            return res.status(400).json({
                code: 400,
                email: "Email does not exist.",
            });
        }

        if (account.disabled_until) {
            return res.status(400).json({
                code: 400,
                email: "This account has been disabled.",
            });
        }
        
        return res.status(204).send();
    }
    catch(error) {
        logText(error, "error");

        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        }); 
    }
});

router.post("/fingerprint", (_, res) => {
    let fingerprint = `${Snowflake.generate()}.${globalUtils.generateString(27)}`;

    return res.status(200).json({
        fingerprint: fingerprint
    })
});

module.exports = router;
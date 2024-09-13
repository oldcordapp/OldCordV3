const express = require('express');
const router = express.Router();
const globalUtils = require('../helpers/globalutils');
const instanceMiddleware = require('../helpers/middlewares').instanceMiddleware;
const rateLimitMiddleware = require("../helpers/middlewares").rateLimitMiddleware;
const { logText } = require('../helpers/logger');
const Snowflake = require('../helpers/snowflake');
const recaptcha = require('../helpers/recaptcha');
const fs = require('fs');

global.config = globalUtils.config;

router.post("/register", instanceMiddleware("NO_REGISTRATION"), rateLimitMiddleware(global.config.ratelimit_config.registration.maxPerTimeFrame, global.config.ratelimit_config.registration.timeFrame), async (req, res) => {
    try {
        let release_date = req.client_build;

        if (!req.body.email && release_date == "june_12_2015") {
            req.body.email = `june_12_2015_app${globalUtils.generateString(10)}@oldcordapp.com`
        } else if (!req.body.email && !req.header("referer").includes("/invite/")) {
            return res.status(400).json({
                code: 400,
                email: "This field is required",
            });
        }

        if (req.body.email && !req.body.email.includes("@")) {
            return res.status(400).json({
                code: 400,
                email: "This field is required",
            });
        }

        if (!req.body.password && release_date == "june_12_2015") {
            req.body.password = globalUtils.generateString(20);
        } else if (!req.body.password && !req.header("referer").includes("/invite/")) {
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

        let goodUsername = globalUtils.checkUsername(req.body.username);

        if (goodUsername.code !== 200) {
            return res.status(goodUsername.code).json(goodUsername);
        }

        let badEmail = await globalUtils.badEmail(req.body.email);

        if (badEmail) {
            return res.status(400).json({
                code: 400,
                email: "That email address is not allowed. Try another.",
            });
        }

        //Before July 2016 Discord had no support for Recaptcha.
        //We get around this by redirecting clients on 2015/2016 who wish to make an account to a working 2018 client then back to their original clients after they make their account/whatever.
        
        if (global.config.captcha_config.enabled) {
            if (req.body.captcha_key === undefined || req.body.captcha_key === null) {
                return res.status(400).json({
                    captcha_key: "Captcha is required."
                });
            }

            let verifyAnswer = await recaptcha.verify(req.body.captcha_key);

            if (!verifyAnswer) {
                return res.status(400).json({
                    captcha_key: "Invalid captcha response."
                });
            }
        }

        if (req.header("referer").includes("/invite/")) {
            req.body.email = null
            req.body.password = null
        }
       
        let emailToken = globalUtils.generateString(60);

        if (!global.config.email_config.enabled) {
            emailToken = null;
        }

        const registrationAttempt = await global.database.createAccount(req.body.username, req.body.email, req.body.password, req.ip ?? 'NULL', emailToken);

        if ('reason' in registrationAttempt) {
            return res.status(400).json({
                code: 400,
                email: registrationAttempt.reason
            });
        }

        let account = await global.database.getAccountByToken(registrationAttempt.token);

        if (account == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (emailToken != null) {
            await global.emailer.sendRegistrationEmail(req.body.email, emailToken, account);
        }

        if (req.body.invite) {
            let code = req.body.invite;
            
            let invite = await global.database.getInvite(code);

            if (invite) {
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
                        activities: [],
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
                    activities: [],
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

router.post("/login", rateLimitMiddleware(global.config.ratelimit_config.registration.maxPerTimeFrame, global.config.ratelimit_config.registration.timeFrame), async (req, res) => {
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
    
        const loginAttempt = await global.database.checkAccount(req.body.email, req.body.password, req.ip ?? 'NULL');
    
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

router.post("/logout", rateLimitMiddleware(global.config.ratelimit_config.registration.maxPerTimeFrame, global.config.ratelimit_config.registration.timeFrame), async (req, res) => {
    return res.status(204).send();
});

router.post("/forgot", rateLimitMiddleware(global.config.ratelimit_config.registration.maxPerTimeFrame, global.config.ratelimit_config.registration.timeFrame), async (req, res) => {
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

        //let emailToken = globalUtils.generateString(60);
        //to-do: but basically, handle the case if the user is unverified - then verify them aswell as reset pw
        
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

router.post("/verify", rateLimitMiddleware(global.config.ratelimit_config.registration.maxPerTimeFrame, global.config.ratelimit_config.registration.timeFrame), async (req, res) => {
    try {
        let auth_token = req.headers['authorization'];

        if (!auth_token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            })
        }

        let account = await global.database.getAccountByToken(auth_token);

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            })
        }

        let token = req.body.token;

        if (!token) {
            return res.status(400).json({
                code: 400,
                token: "This field is required."
            });
        }

        if (global.config.captcha_config.enabled) {
            if (req.body.captcha_key === undefined || req.body.captcha_key === null) {
                return res.status(400).json({
                    captcha_key: "Captcha is required."
                });
            }

            let verifyAnswer = await recaptcha.verify(req.body.captcha_key);

            if (!verifyAnswer) {
                return res.status(400).json({
                    captcha_key: "Invalid captcha response."
                });
            }
        }

        let tryUseEmailToken = await global.database.useEmailToken(account.id, token);

        if (!tryUseEmailToken) {
            return res.status(400).json({
                token: "Invalid email verification token."
            });
        }

        return res.status(200).json({
            token: req.headers['authorization']
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

router.post("/verify/resend", rateLimitMiddleware(global.config.ratelimit_config.registration.maxPerTimeFrame, global.config.ratelimit_config.registration.timeFrame), async (req, res) => {
    try {
        let auth_token = req.headers['authorization'];

        if (!auth_token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            })
        }

        let account = await global.database.getAccountByToken(auth_token);

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            })
        }

        if (account.verified) {
            return res.status(204).send();
        }

        if (!global.config.email_config.enabled) {
            return res.status(204).send();
        }

        let emailToken = await global.database.getEmailToken(account.id);
        let newEmailToken = false;

        if (!emailToken) {
            emailToken = globalUtils.generateString(60);
            newEmailToken = true;
        }

        let trySendRegEmail = await global.emailer.sendRegistrationEmail(account.email, emailToken, account);

        if (!trySendRegEmail) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }

        if (newEmailToken) {
            let tryUpdate = await global.database.updateEmailToken(account.id, emailToken);

            if (!tryUpdate) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });  
            }
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

module.exports = router;
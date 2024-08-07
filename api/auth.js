const express = require('express');
const router = express.Router();
const globalUtils = require('../helpers/globalutils');
const database = require('../helpers/database');
const dispatcher = require('../helpers/dispatcher');
const instanceMiddleware = require('../helpers/middlewares').instanceMiddleware;
const rateLimitMiddleware = require("../helpers/middlewares").rateLimitMiddleware;
const { logText } = require('../helpers/logger');

const config = globalUtils.config;

router.post("/register", instanceMiddleware("NO_REGISTRATION"), rateLimitMiddleware(5, 1000 * 60 * 60), async (req, res) => {
    try {
        let release_date = req.client_build;
        let ignore_missing_fields = release_date == "june_12_2015";
    
        if (!req.body.email && !ignore_missing_fields) {
            return res.status(400).json({
                code: 400,
                email: "This field is required",
            });
        } else req.body.email = `june_12_2015_app${globalUtils.generateString(10)}@oldcordrouter.com`

        if (!req.body.username) {
            return res.status(400).json({
                code: 400,
                username: "This field is required",
            });
        }

        if (!req.body.password && !ignore_missing_fields) {
            return res.status(400).json({
                code: 400,
                email: "This field is required",
            });
        } else req.body.password = globalUtils.generateString(20);
        
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

        const registrationAttempt = await database.createAccount(req.body.username, req.body.email, req.body.password);

        if ('reason' in registrationAttempt) {
            return res.status(400).json({
                code: 400,
                email: registrationAttempt.reason
            });
        } 

        const autoJoinGuild = config.instance_flags.filter(x => x.toLowerCase().includes("autojoin:"));

        if (autoJoinGuild.length > 0) {
            let guildId = autoJoinGuild[0].split(':')[1];

            let guild = await database.getGuildById(guildId);

            if (guild != null) {
                let account = await database.getAccountByToken(registrationAttempt.token);

                if (account == null) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }

                await database.joinGuild(account.id, guildId);

                dispatcher.dispatchEventTo(registrationAttempt.token, "GUILD_CREATE", guild);

                await dispatcher.dispatchEventInGuild(guildId, "GUILD_MEMBER_ADD", {
                    roles: [],
                    user: {
                        username: account.username,
                        discriminator: account.discriminator,
                        id: account.id,
                        avatar: account.avatar
                    },
                    guild_id: guildId
                });

                await dispatcher.dispatchEventInGuild(guildId, "PRESENCE_UPDATE", {
                    game_id: null,
                    status: "online",
                    user: {
                        username: account.username,
                        discriminator: account.discriminator,
                        id: account.id,
                        avatar: account.avatar
                    },
                    guild_id: guildId
                });
            }
        }

        return res.status(200).json({
            token: registrationAttempt.token,
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
    
        const loginAttempt = await database.checkAccount(req.body.email, req.body.password);
    
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
        logText(error.toString(), "error");

        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/logout", (_, res) => {
    return res.status(204).send();
});

router.post("/forgot", (_, res) => {
    return res.status(204).send();
});

module.exports = router;
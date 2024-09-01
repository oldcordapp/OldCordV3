const express = require('express');
const { logText } = require('../../helpers/logger');
const Snowflake = require('../../helpers/snowflake');
const router = express.Router({ mergeParams: true });
const applications = require('./applications');
const tokens = require('./tokens');
const globalUtils = require('../../helpers/globalutils');
const permissions = require('../../helpers/permissions');

router.use("/applications", applications);

router.use("/tokens", tokens);

router.get("/authorize", async (req, res) => {
    try {
        let account = req.account;

        if (!account || account.bot) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });  
        }

        let client_id = req.query.client_id;
        let scope = req.query.scope;

        if (!client_id) {
            return res.status(400).json({
                code: 400,
                client_id: "This parameter is required"
            });
        }

        if (!scope) {
            return res.status(400).json({
                code: 400,
                scope: "This parameter is required"
            });
        }

        let return_obj = {
            authorized: false
        };

        let application = await global.database.getApplicationById(client_id);

        if (!application) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Application"
            });
        }

        if (scope === 'bot') {
            let bot = await global.database.getBotByApplicationId(application.id);

            if (!bot) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Bot"
                });
            }

            if (!bot.public && application.owner.id != account.id) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Bot"
                });
            }
            
            let is_public = bot.public;
            let requires_code_grant = bot.require_code_grant;

            delete bot.public;
            delete bot.require_code_grant;
            delete bot.token;

            application.bot = bot;
            application.bot_public = is_public;
            application.bot_require_code_grant = requires_code_grant;
        }

        delete application.redirect_uris;
        delete application.rpc_application_state;
        delete application.rpc_origins;
        delete application.secret;
        delete application.owner; //to-do this somewhere else

        return_obj.application = application;

        if (application.bot) {
            return_obj.bot = application.bot;
        }

        return_obj.redirect_uri = null;

        return_obj.user = globalUtils.miniUserObject(account);

        let guilds = await global.database.getUsersGuilds(account.id);

        let guilds_array = [];

        if (guilds.length > 0) {
            for(var guild of guilds) {
                let member = guild.members.find(x => x.id === account.id);

                if (!member) continue; //how?

                if (guild.members.find(x => x.id === application.bot.id)) continue; //fuc kyou

                let roles = member.roles;
                
                let permissions_number = 0;

                for(var role of roles) {
                    let guildRole = guild.roles.find(x => x.id === role);

                    if (!guildRole) continue;

                    permissions_number |= role.permissions;
                }

                if (global.permissions.has(permissions_number, "ADMINISTRATOR") || global.permissions.has(permissions_number, "MANAGE_GUILD") || guild.owner_id === account.id) {
                    guilds_array.push({
                        id: guild.id,
                        icon: guild.icon,
                        name: guild.name,
                        permissions: permissions_number === 0 ? 2146958719 : permissions_number,
                        region: null
                    });
                }
            }
        }

        return_obj.guilds = guilds_array;

        return res.status(200).json(return_obj);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/authorize", async (req, res) => {
    try {
        let account = req.account;

        if (!account || account.bot) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });  
        }

        let client_id = req.query.client_id;
        let scope = req.query.scope;
        let permissions = parseInt(req.query.permissions);

        if (!client_id) {
            return res.status(400).json({
                code: 400,
                client_id: "This parameter is required"
            });
        }

        if (!scope) {
            return res.status(400).json({
                code: 400,
                scope: "This parameter is required"
            });
        }

        if (!permissions || isNaN(permissions)) {
            permissions = 0;
        }

        let application = await global.database.getApplicationById(client_id);

        if (!application) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Application"
            });
        }

        let guild_id = null;

        if (scope === 'bot') {
            if (!req.body.bot_guild_id) {
                return res.status(403).json({
                    code: 403,
                    message: "Missing Permissions"
                });  
            }

            guild_id = req.body.bot_guild_id;

            let bot = await global.database.getBotByApplicationId(application.id);

            if (!bot) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Bot"
                });
            }

            if (!bot.public && application.owner.id != account.id) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Bot"
                });
            }
        
            application.bot = bot;
        }

        let guilds = await global.database.getUsersGuilds(account.id);

        if (!guilds || guild_id === null) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        let guild = guilds.find(x => x.id === req.body.bot_guild_id);

        if (!guild) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        let member = guild.members.find(x => x.id === account.id);

        if (!member) {
            return res.status(403).json({
                code: 403,
                scope: "Missing Permissions"
            });
        }

        let botAlrThere = guild.members.find(x => x.id === application.bot.id);

        if (botAlrThere) {
            return res.status(403).json({
                code: 403,
                scope: "Missing Permissions"
            });
        }

        let roles = member.roles;

        let permissions_number = 0;

        for(var role of roles) {
            let guildRole = guild.roles.find(x => x.id === role);

            if (!guildRole) continue;

            permissions_number |= role.permissions;
        }

        if (global.permissions.has(permissions_number, "ADMINISTRATOR") || global.permissions.has(permissions_number, "MANAGE_GUILD") || guild.owner_id === account.id) {
            //do the stuff

            const isBanned = await database.isBannedFromGuild(guild.id, application.bot.id);

            if (isBanned) {
                return res.status(403).json({
                    code: 403,
                    scope: "Missing Permissions"
                });
            }

            let tryJoinBot = await global.database.joinGuild(application.bot.id, guild);

            if (!tryJoinBot) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            await global.dispatcher.dispatchEventTo(application.bot.id, "GUILD_CREATE", guild);

            await global.dispatcher.dispatchEventInGuild(guild, "GUILD_MEMBER_ADD", {
                roles: [],
                user: globalUtils.miniBotObject(application.bot),
                guild_id: guild.id
            });

            await global.dispatcher.dispatchEventInGuild(guild, "PRESENCE_UPDATE", {
                game_id: null,
                status: "online",
                activities: [],
                user: globalUtils.miniBotObject(application.bot),
                guild_id: guild.id
            });

            return res.json({ location: `${req.protocol}://${req.get('host')}/oauth2/authorized` })
        } else {
            return res.status(403).json({
                code: 403,
                scope: "Missing Permissions"
            });
        }
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
const express = require('express');
const { logText } = require('../../helpers/logger');
const Snowflake = require('../../helpers/snowflake');
const globalUtils = require('../../helpers/globalutils');
const router = express.Router({ mergeParams: true });

router.param('applicationid', async (req, res, next, applicationid) => {
    req.application = await global.database.getApplicationById(applicationid);
    
    if (req.application) {
        let bot = await global.database.getBotByApplicationId(applicationid);

        if (bot) {
            let is_public = bot.public;
            let requires_code_grant = bot.require_code_grant;

            delete bot.public;
            delete bot.require_code_grant;
            delete bot.bot; //it already knows dummy

            req.application.bot = bot;
            req.application.bot_public = is_public;
            req.application.bot_require_code_grant = requires_code_grant;
        }
    }

    next();
});

router.get("/", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            })
        }

        let applications = await global.database.getUsersApplications(req.account);

        for(var application of applications) {
            let bot = await global.database.getBotByApplicationId(application.id);

            if (!bot) continue;
            
            let is_public = bot.public;
            let requires_code_grant = bot.requires_code_grant;

            delete bot.public;
            delete bot.require_code_grant;
            delete bot.bot; //it already knows dummy

            application.bot = bot;
            application.bot_public = is_public;
            application.bot_require_code_grant = requires_code_grant;
        }

        return res.status(200).json(applications);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            })
        }

        let name = req.body.name;

        if (!name) {
            return res.status(400).json({
                code: 400,
                name: "This field is required"
            })
        }

        if (name.length < 2 || name.length > 30) {
            return res.status(400).json({
                code: 400,
                name: "Must be between 2 and 30 characters."
            })
        }

        let application = await global.database.createUserApplication(req.account, name);

        if (!application) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(200).json(application);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.get("/:applicationid", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            })
        }

        if (req.application.owner.id != account.id) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Application"
            }); 
        }

        return res.status(200).json(req.application);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:applicationid", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            })
        }

        let application = req.application;

        if (!application || application.owner.id !== account.id) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Application"
            });
        }

        if (req.body.name) {
            application.name = req.body.name;
        }

        if (req.body.icon === "") {
            application.icon = null;
        }

        if (req.body.icon) {
            application.icon = req.body.icon;
        }

        let send_update_bot = false;

        if (req.body.bot_public != undefined && application.bot) {
            application.bot_public = req.body.bot_public;
            application.bot.public = req.body.bot_public;

            send_update_bot = true;
        }

        if (req.body.bot_require_code_grant != undefined && application.bot) {
            application.bot_require_code_grant = req.body.bot_require_code_grant;
            application.bot.require_code_grant = req.body.bot_require_code_grant;

            send_update_bot = true;
        }

        if (req.body.description) {
            application.description;
        }

        if (application.name.length < 2 || application.name.length > 30) {
            return res.status(400).json({
                code: 400,
                name: "Must be between 2 and 30 characters."
            })
        }

        if (application.description.length > 400) {
            return res.status(400).json({
                code: 400,
                description: "Must be under 400 characters."
            })
        }

        let tryUpdateApplication = await global.database.updateUserApplication(account, application);

        if (!tryUpdateApplication) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }

        if (send_update_bot) {
            let tryUpdateBot = await global.database.updateBot(application.bot);

            if (!tryUpdateBot) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                }); 
            }

            tryUpdateApplication.bot = tryUpdateBot;

            delete tryUpdateApplication.bot.public;
            delete tryUpdateApplication.bot.require_code_grant;
        }

        req.application = tryUpdateApplication;
        
        return res.status(200).json(tryUpdateApplication);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/:applicationid/bot", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            })
        }

        let application = req.application;

        if (!application || application.owner.id != account.id) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Application"
            });
        }

        if (application.bot) {
            return res.status(400).json({
                code: 400,
                message: "This application has already been turned into a bot"
            });
        }

        let tryCreateBot = await global.database.abracadabraApplication(application);

        if (!tryCreateBot) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(200).json(tryCreateBot);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
const express = require('express');
const { logText } = require('../../helpers/logger');
const Snowflake = require('../../helpers/snowflake');
const router = express.Router({ mergeParams: true });
const applications = require('./applications');
const tokens = require('./tokens');
const globalUtils = require('../../helpers/globalutils');

router.use("/applications", applications);

router.use("/tokens", tokens);

/*
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
                scope: "Unknown Application"
            });
        }

        if (scope === 'bot') {
            let bot = await global.database.getBotByApplicationId(application.id);

            if (!bot) {
                return res.status(404).json({
                    code: 404,
                    scope: "Unknown Bot"
                });
            }

            if (!bot.public && application.owner.id != account.id) {
                return res.status(404).json({
                    code: 404,
                    scope: "Unknown Bot"
                });
            }
            
            let is_public = bot.public;
            let requires_code_grant = bot.require_code_grant;

            delete bot.public;
            delete bot.require_code_grant;

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
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});
*/

module.exports = router;
const express = require('express');
const { logText } = require('../helpers/logger');
const { guildPermissionsMiddleware, guildMiddleware } = require('../helpers/middlewares');
const globalUtils = require('../helpers/globalutils');
const Snowflake = require('../helpers/snowflake');
const fs = require('fs');
const router = express.Router({ mergeParams: true });
const config = globalUtils.config;

router.get("/guilds/search", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (!config.instance_admins.includes(account.id)) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            }); //to-do move this to its own thing
        }

        let search = req.query.input;

        console.log(search);

        if (!search) {
            return res.status(400).json({
                code: 400,
                search: "This is required."
            });  
        }

        let tryNumber = parseInt(search);
        let isGuildId = false;

        if (tryNumber !== NaN) {
            isGuildId = true;
        }

        if (!isGuildId) {
            return res.status(400).json({
                code: 400,
                message: "Guild partial name/name search is not Implemented"
            });
        }

        let guild = await global.database.getGuildById(tryNumber);

        console.log(guild);

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        return res.status(200).json(guild);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
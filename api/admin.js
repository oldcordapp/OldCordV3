const express = require('express');
const { logText } = require('../helpers/logger');
const { staffAccessMiddleware } = require('../helpers/middlewares');
const router = express.Router({ mergeParams: true });

router.get("/guilds/search", staffAccessMiddleware(1), async (req, res) => {
    try {
        let search = req.query.input;

        if (!search) {
            return res.status(400).json({
                code: 400,
                search: "This field is required."
            });  
        }

        let tryNumber = parseInt(search);
        let isGuildId = false;

        if (!isNaN(tryNumber)) {
            isGuildId = true;
        }

        if (!isGuildId) {
            return res.status(400).json({
                code: 400,
                message: "Guild partial name/name search is not implemented."
            });
        }

        let guild = await global.database.getGuildById(search);

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
const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { rateLimitMiddleware, guildMiddleware } = require('../helpers/middlewares');
const { logText } = require('../helpers/logger');
const router = express.Router();

router.param('id', async (req, _, next, id) => {
    //Currently unknown
    next();
});

router.get("/directory/:id", (req, res) => {
    return res.status(200).json({
        data: {
            hero: [],
            premium_carousel: [],
            featured: [],
            premium: [],
            storeListings: [],
            sku_ids: [],
        },
        store_listings: [],
    });
});

module.exports = router;
const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { rateLimitMiddleware, guildMiddleware } = require('../helpers/middlewares');
const { logText } = require('../helpers/logger');
const router = express.Router();
const Snowflake = require('../helpers/snowflake');

router.param('id', async (req, _, next, id) => {
    //Currently unknown
    next();
});

router.get("/directory/:id", (req, res) => {
    let id = req.params.id;
    
    return res.status(200).json({
        sku_id: id,
        type: 1,
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

router.get("/published-listings/skus/:skuId", async (req, res) => {
    let id = req.params.skuId;
    
    return res.status(200).json({
        benefits: [],
        description: "In this game work your way to the top of your own games company! Release a mobile chat application then sell your data to tencent! Sell the platform and then months later have them be fined for privacy violations! Afterwards, start a quirky company for gamers and take the world by storm! Rolling out promising features and stability at first just to have it all unravel into a corporate shell with microtransactions and bloatware. Do you have what it takes to become the CEO of Discord?",
        thumbnail: {
            id: Snowflake.generate(),
            size: 297008,
            mime_type: "image/png",
            width: 1280,
            height: 720
        },
        id: id,
        summary: "In this game work your way to the top of your own games company! Release a mobile chat application then sell your data to tencent! Sell the platform and then months later have them be fined for privacy violations! Afterwards, start a quirky company for gamers and take the world by storm! Rolling out promising features and stability at first just to have it all unravel into a corporate shell with microtransactions and bloatware. Do you have what it takes to become the CEO of Discord?",
        sku: {
            id: id,
            type: 1,
            product_line: 1,
            dependent_sku_id: null,
            application: {
                "id": id,
                "name": "Jason Citron Simulator 2024",
                "icon": null,
                "description": "jasey",
                "summary": "jason boy",
                "type": null,
                "is_monetized": false,
                "is_verified": false,
                "hook": true,
                "storefront_available": false,
                "integration_types_config": {
                    "0": {}
                },
                "verify_key": "93661a9eefe452d12f51e129e8d9340e7ca53a770158c0ec7970e701534b7420",
                "flags": 0
            },
            application_id: id,
            manifest_labels: null,
            access_type: 1,
            name: "JASON CITRON SIMULATOR 2024",
            features: [],
            release_date: "2000-01-01",
            premium: false,
            slug: "jasoncitronsimulator2024",
            flags: 0,
            genres: [],
            legal_notice: "pls dont take this seriously k thx",
            system_requirements: {
                1: {
                    minimum: {
                        operating_system_version: "O",
                        cpu: "L",
                        gpu: "D",
                        ram: 1337000,
                        disk: 1337000,
                        sound_card: "C",
                        directx: "O",
                        network: "R",
                        notes: "D"
                    },
                    recommended: {
                        operating_system_version: "2",
                        cpu: "0",
                        gpu: "2",
                        ram: 1337000,
                        disk: 1337000,
                        sound_card: "4",
                        directx: "Y",
                        network: "a",
                        notes: "a"
                    }
                }
            },
            show_age_gate: false,
            price: {
                amount: 1,
                currency: "usd",
                currency_exponent: 2
            },
            locales: [
                "en-US"
            ]
        },
        tagline: "Jason Citron Simulator 2024",
        box_art: {
            id: Snowflake.generate(),
            size: 95039,
            mime_type: "image/png",
            width: 600,
            height: 800
        },
        preview_video: {
            id: Snowflake.generate(),
            size: 1311923,
            mime_type: "video/mp4",
            width: 640,
            height: 360
        },
        hero_video: {
            id: Snowflake.generate(),
            size: 1311923,
            mime_type: "video/mp4",
            width: 640,
            height: 360
        }
    });
});

module.exports = router;
const express = require('express');
const { logText } = require('../helpers/logger');
const { guildPermissionsMiddleware, guildMiddleware, channelMiddleware, channelPermissionsMiddleware } = require('../helpers/middlewares');
const globalUtils = require('../helpers/globalutils');
const Snowflake = require('../helpers/snowflake');
const fs = require('fs');
const router = express.Router({ mergeParams: true });

router.param('webhookid', async (req, res, next, webhookid) => {
    req.webhook = await global.database.getWebhookById(webhookid);

    next();
});

router.patch("/:webhookid", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        } 

        if (!req.body.channel_id) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });  
        }

        let channel = await global.database.getChannelById(req.body.channel_id);

        if (!channel) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });  
        }

        let webhook = req.webhook;

        if (!webhook) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Webhook"
            }); 
        }

        let guild = await global.database.getGuildById(webhook.guild_id);

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            }); 
        }

        const hasPermission = await global.permissions.hasGuildPermissionTo(guild, account.id, "MANAGE_WEBHOOKS", req.client_build);

        if (!hasPermission) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            }); 
        }

        if (req.body.name && req.body.name.length < 2) {
            return res.status(400).json({
                code: 400,
                name: "Name must be between 2 and 25 characters."
            });  
        }

        if (req.body.name && req.body.name.length > 25) {
            return res.status(400).json({
                code: 400,
                name: "Name must be between 2 and 25 characters."
            });  
        }

        let tryUpdate = await global.database.updateWebhook(webhook.id, channel.id, req.body.name ?? "Captain Hook", req.body.avatar ?? "NULL");

        if (!tryUpdate) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(200).json(tryUpdate);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.delete("/:webhookid", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        } 

        let webhook = req.webhook;

        if (!webhook) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Webhook"
            }); 
        }

        let guild = await global.database.getGuildById(webhook.guild_id);

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            }); 
        }

        const hasPermission = await global.permissions.hasGuildPermissionTo(guild, account.id, "MANAGE_WEBHOOKS", req.client_build);

        if (!hasPermission) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            }); 
        }

        let tryDelete = await global.database.deleteWebhook(webhook.id);

        if (!tryDelete) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
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

router.post("/:webhookid/:webhooktoken", async (req, res) => {
    try {
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
                message: "Unknown Webhook"
            }); 
        }

        let channel = await global.database.getChannelById(webhook.channel_id);

        if (!channel) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Webhook"
            }); 
        }

        const createMessage = await global.database.createMessage(!channel.guild_id ? null : channel.guild_id, channel.id, "WEBHOOK_" + webhook.id, req.body.content, req.body.nonce, null, req.body.tts, false, req.body.username ? { username: req.body.username } : null, []);

        if (!createMessage) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventInChannel(guild, channel.id, "MESSAGE_CREATE", createMessage);

        return res.status(204).send();
    } catch (error) {
        console.log("error within here?");

        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/:webhookid/:webhooktoken/github", async (req, res) => {
    try {
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
                message: "Unknown Webhook"
            }); 
        }

        let channel = await global.database.getChannelById(webhook.channel_id);

        if (!channel) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Webhook"
            }); 
        }

        let embeds = [];

        if (req.body.commits && req.body.commits.length > 0) {
            let commit_url = null;
            let description = null;

            if (req.body.commits.length == 1) {
                commit_url = `${req.body.repository.html_url}/commit/${req.body.commits[0].id}`

                description = "[`" + req.body.commits[0].id.slice(0, 7) + "`]" + `(${commit_url}) ${req.body.commits[0].message} - ${req.body.commits[0].author.name}`
            } else {
                commit_url = `${req.body.repository.html_url}/compare/${req.body.commits[0].id.slice(0, 7)}...${req.body.commits[req.body.commits.length - 1].id.slice(0, 7)}`

                for(var commit of req.body.commits) {
                   let c_url = `${req.body.repository.html_url}/commit/${commit.id}`;

                   description += `\n` + "[`" + commit.id.slice(0, 7) + "`]" + `(${c_url}) ${commit.message} - ${commit.author.name}`
                }
            }

            embeds = [{
                type: "rich",
                color: 7506394,
                title: `[${req.body.repository.name}:${req.body.ref.replace("refs/heads/", "")}] ${req.body.commits.length} new commit(s)`,
                url: commit_url,
                description: description,
                author: {
                    icon_url: req.body.sender.avatar_url,
                    name: req.body.sender.login,
                    proxy_icon_url: req.body.sender.avatar_url,
                    url: req.body.sender.url
                }
            }]
        }

        const createMessage = await global.database.createMessage(!channel.guild_id ? null : channel.guild_id, channel.id, "WEBHOOK_" + webhook.id, req.body.content, req.body.nonce, null, req.body.tts, false, req.body.username ? { username: req.body.username } : null, embeds);

        if (!createMessage) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        await global.dispatcher.dispatchEventInChannel(guild, channel.id, "MESSAGE_CREATE", createMessage);

        return res.status(204).send();
    } catch (error) {
        console.log("error within here?");

        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
const express = require('express');
const { logText } = require('../helpers/logger');
const { guildPermissionsMiddleware, guildMiddleware, channelMiddleware, channelPermissionsMiddleware } = require('../helpers/middlewares');
const globalUtils = require('../helpers/globalutils');
const Snowflake = require('../helpers/snowflake');
const fs = require('fs');
const router = express.Router({ mergeParams: true });
const fetch = require('node-fetch');
const path = require("path");
const md5 = require('md5');

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
            await globalUtils.unavailableGuild(guild, "Updating webhook failed");

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
            await globalUtils.unavailableGuild(guild, "Deleting webhook failed");

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

        let create_override = false;
        let override = {
            username: null,
            avatar_url: null
        };

        if (req.body.username) {
            create_override = true;

            override.username = req.body.username;
        }

        if (req.body.avatar_url) {
            create_override = true;

            try {
                const response = await fetch(req.body.avatar_url);

                if (response.ok) {
                    const contentType = response.headers.get('content-type');
                    const extension = contentType.split('/')[1]; // 'png', 'jpeg', etc.
            
                    var name = Math.random().toString(36).substring(2, 15) + Math.random().toString(23).substring(2, 5);
                    var name_hash = md5(name);

                    if (extension == "jpeg") {
                        extension = "jpg";
                    }
        
                    if (!fs.existsSync(`./www_dynamic/avatars/${webhook.id}`)) {
                        fs.mkdirSync(`./www_dynamic/avatars/${webhook.id}`, { recursive: true });
                    }
    
                    const buffer = await response.buffer();

                    await fs.promises.writeFile(`./www_dynamic/avatars/${webhook.id}/${name_hash}.${extension}`, buffer);
        
                    override.avatar_url = name_hash;
                }
            } catch (error) {
                logText(error, "error");
            }
        }

        let override_id = Snowflake.generate();

        let createMessage = null;
        let embeds = [];

        if (req.body.embeds) {
            for(var embed of req.body.embeds) {
                let embedObj = {
                    type: "rich",
                    color: embed.color ?? 7506394
                };

                if (embed.title) {
                    embedObj.title = embed.title;
                }

                if (embed.description) {
                    embedObj.description = embed.description;
                }

                if (embed.author) {
                    embedObj.author = {
                        icon_url: embed.author.icon_url ? `/proxy?url=${embed.author.icon_url}` : null,
                        name: embed.author.name ?? null,
                        proxy_icon_url: embed.author.icon_url ? `/proxy?url=${embed.author.icon_url}` : null,
                        url: embed.author.url ?? null
                    }
                }

                if (embed.fields) {
                    embedObj.fields = embed.fields;
                }

                embeds.push(embedObj);
            }
        }

        if (create_override) {
            createMessage = await global.database.createMessage(!channel.guild_id ? null : channel.guild_id, channel.id, "WEBHOOK_" + webhook.id + "_" + override_id, req.body.content, req.body.nonce, null, req.body.tts, false, override, embeds);
        } else createMessage = await global.database.createMessage(!channel.guild_id ? null : channel.guild_id, channel.id, "WEBHOOK_" + webhook.id, req.body.content, req.body.nonce, null, req.body.tts, false, null, embeds);

        if (!createMessage) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        if (create_override) {
            let tryCreateOverride = await global.database.createWebhookOverride(webhook.id, override_id, override.username, override.avatar_url);

            if (!tryCreateOverride) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            createMessage.author.username = override.username ?? webhook.name;
            createMessage.author.avatar = override.avatar_url; //to-do
        }

        await global.dispatcher.dispatchEventInChannel(guild, channel.id, "MESSAGE_CREATE", createMessage);

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/:webhookid/:webhooktoken/github", async (req, res) => {
    try {
        //console.log(JSON.stringify(req.body)); -- uncomment for github's weird webhook payloads
    
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

        let override = {
            username: "GitHub",
            avatar_url: "github"
        };

        if (!fs.existsSync(`./www_dynamic/avatars/${webhook.id}`)) {
            fs.mkdirSync(`./www_dynamic/avatars/${webhook.id}`, { recursive: true });
        }
        
        if (!fs.existsSync(`./www_dynamic/avatars/${webhook.id}/github.png`)) {
            fs.copyFileSync(`./www_static/assets/misc/github.png`, `./www_dynamic/avatars/${webhook.id}/github.png`);
        }

        let override_id = Snowflake.generate();

        let embeds = [];

        if (req.body.commits && req.body.commits.length > 0) {
            let commit_url = null;
            let description = null;

            if (req.body.commits.length == 1) {
                commit_url = `${req.body.repository.html_url}/commit/${req.body.commits[0].id}`

                description = "[`" + req.body.commits[0].id.slice(0, 7) + "`]" + `(${commit_url}) ${req.body.commits[0].message.length > 50 ? req.body.commits[0].message.slice(0, 50) + "..." : req.body.commits[0].message} - ${req.body.commits[0].author.username}`
            } else {
                commit_url = `${req.body.repository.html_url}/compare/${req.body.commits[0].id.slice(0, 7)}...${req.body.commits[req.body.commits.length - 1].id.slice(0, 7)}`

                for(var commit of req.body.commits) {
                   let c_url = `${req.body.repository.html_url}/commit/${commit.id}`;

                   description += `\n` + "[`" + commit.id.slice(0, 7) + "`]" + `(${c_url}) ${commit.message.length > 50 ? commit.message.slice(0, 50) + "..." : commit.message} - ${commit.author.username}`
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

        const createMessage = await global.database.createMessage(!channel.guild_id ? null : channel.guild_id, channel.id, "WEBHOOK_" + webhook.id, req.body.content, req.body.nonce, null, req.body.tts, false, override, embeds);

        if (!createMessage) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        let tryCreateOverride = await global.database.createWebhookOverride(webhook.id, override_id, override.username, override.avatar_url);

        if (!tryCreateOverride) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        createMessage.author.username = override.username;
        createMessage.author.avatar = override.avatar_url;

        await global.dispatcher.dispatchEventInChannel(guild, channel.id, "MESSAGE_CREATE", createMessage);

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
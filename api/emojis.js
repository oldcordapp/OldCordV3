const express = require('express');
const { logText } = require('../helpers/logger');
const { guildPermissionsMiddleware, guildMiddleware } = require('../helpers/middlewares');
const globalUtils = require('../helpers/globalutils');
const Snowflake = require('../helpers/snowflake');
const fs = require('fs');
const router = express.Router({ mergeParams: true });

router.get("/", guildMiddleware, guildPermissionsMiddleware("MANAGE_EMOJIS"), async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });  
        }

        let emojis = guild.emojis;

        return res.status(200).json(emojis);
    } catch (error) {
        logText(error, "error");
    
        await globalUtils.unavailableGuild(req.guild, error);

        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/", guildMiddleware, guildPermissionsMiddleware("MANAGE_EMOJIS"), async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });  
        }

        const base64Data = req.body.image.split(';base64,').pop();
        const mimeType = req.body.image.split(';')[0].split(':')[1];
        const extension = mimeType.split('/')[1];

        let emoji_id = Snowflake.generate();

        if (!fs.existsSync(`./www_dynamic/emojis`)) {
            fs.mkdirSync(`./www_dynamic/emojis`, { recursive: true });
        }

        const filePath = `./www_dynamic/emojis/${emoji_id}.${extension}`;

        const imageBuffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(filePath, imageBuffer);

        let tryCreateEmoji = await global.database.createCustomEmoji(guild, account.id, emoji_id, req.body.name);

        if (!tryCreateEmoji) {
            await globalUtils.unavailableGuild(guild, "Something went wrong creating an emoji");

            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        let currentEmojis = guild.emojis;

        for(var emoji of currentEmojis) {
            emoji.roles = [];
            emoji.require_colons = true;
            emoji.managed = false;
            emoji.allNamesString = `:${emoji.name}:`
        }

        await global.dispatcher.dispatchEventInGuild(guild, "GUILD_EMOJIS_UPDATE", {
            guild_id: guild.id,
            emojis: currentEmojis
        });

        return res.status(201).json({
            allNamesString: `:${req.body.name}:`,
            guild_id: guild.id,
            id: emoji_id,
            managed: false,
            name: req.body.name,
            require_colons: true,
            roles: [],
            user: globalUtils.miniUserObject(account)
        })
    } catch (error) {
        logText(error, "error");
    
        await globalUtils.unavailableGuild(req.guild, error);

        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:emoji", guildMiddleware, guildPermissionsMiddleware("MANAGE_EMOJIS"), async (req, res) => {
    try {
        let account = req.account;
        
        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });  
        }

        let emoji_id = req.params.emoji;
        
        let emoji = req.guild.emojis.find(x => x.id === emoji_id);

        if (emoji == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Emoji"
            });  
        }

        if (!req.body.name) {
            return res.status(400).json({
                code: 400,
                name: "This field is required"
            });   
        }

        if (req.body.name < 2) {
            return res.status(400).json({
                code: 400,
                name: "Emoji name must be at least 2 characters long"
            });  
        }

        if (req.body.name > 30) {
            return res.status(400).json({
                code: 400,
                name: "Emoji name must be under 30 characters long"
            });    
        }

        let tryUpdate = await global.database.updateCustomEmoji(guild, emoji_id, req.body.name);

        if (!tryUpdate) {
            await globalUtils.unavailableGuild(req.guild, "Something went wrong while updating an emoji");

            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        let currentEmojis = guild.emojis;

        for(var emoji2 of currentEmojis) {
            emoji2.roles = [];
            emoji2.require_colons = true;
            emoji2.managed = false;
            emoji2.allNamesString = `:${emoji.name}:`
        }

        await global.dispatcher.dispatchEventInGuild(guild, "GUILD_EMOJIS_UPDATE", {
            guild_id: guild.id,
            emojis: currentEmojis
        });

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");
    
        await globalUtils.unavailableGuild(req.guild, error);

        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.delete("/:emoji", guildMiddleware, guildPermissionsMiddleware("MANAGE_EMOJIS"), async (req, res) => {
    try {
        let account = req.account;
        
        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });  
        }

        let emoji_id = req.params.emoji;
        
        let emoji = req.guild.emojis.find(x => x.id === emoji_id);

        if (emoji == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Emoji"
            });  
        }

        let tryDelete = await global.database.deleteCustomEmoji(guild, emoji_id);

        if (!tryDelete) {
            await globalUtils.unavailableGuild(req.guild, "Something went wrong while deleting an emoji");

            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        let currentEmojis = guild.emojis;

        for(var emoji2 of currentEmojis) {
            emoji2.roles = [];
            emoji2.require_colons = true;
            emoji2.managed = false;
            emoji2.allNamesString = `:${emoji.name}:`
        }

        await global.dispatcher.dispatchEventInGuild(guild, "GUILD_EMOJIS_UPDATE", {
            guild_id: guild.id,
            emojis: currentEmojis
        });

        return res.status(204).send();
    } catch (error) {
        logText(error, "error");
    
        await globalUtils.unavailableGuild(req.guild, error);
        
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
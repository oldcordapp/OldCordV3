const { Pool } = require('pg');
const { logText } = require('./logger');
const globalUtils = require('./globalutils');
const { genSalt, hash, compareSync } = require('bcrypt');
const Snowflake = require('./snowflake');
const fs = require('fs');
const md5 = require('md5');
const path = require('path');
const embedder = require('./embedder');

let db_config = globalUtils.config.db_config;
let config = globalUtils.config;

const pool = new Pool(db_config);
let cache = {};

const database = {
    client: null,
    runQuery: async (queryString, values) => {
        if (database.client == null) {
            database.client = await pool.connect();
            database.client.on('error', (err) => {
                console.log(err);
            });
            database.client.connection.on('error', (err) => {
                console.log(err);
            });
        }
        
        try {
            const query = {
                text: queryString,
                values: values
            };

            const cacheKey = JSON.stringify(query);

            if (queryString.includes("SELECT * ")) {
                if (cache[cacheKey]) {
                    return cache[cacheKey];
                }

                const result = await database.client.query(query);

                const rows = result.rows;

                if (rows.length === 0) {
                    return null;
                }

                cache[cacheKey] = rows;
        
                return rows;
            } else if (queryString.includes("DELETE FROM") || queryString.includes("UPDATE") || queryString.includes("INSERT INTO")) {
                let tableName  = "";

                if (queryString.startsWith("DELETE FROM")) {
                    tableName = queryString.split(' ')[2];
                } else if (queryString.startsWith("UPDATE")) {
                    tableName = queryString.split('SET')[0].split('UPDATE ')[1].split(' ')[0];
                } else if (queryString.startsWith("INSERT INTO")) {
                    tableName = queryString.split('INSERT INTO ')[1].split(' ')[0];
                }

                for (const key in cache) {
                    if (key.includes(tableName)) {
                        delete cache[key];
                    }
                }
            }

            const result = await database.client.query(query);

            const rows = result.rows;

            if (rows.length === 0) {
                return null;
            }
    
            return rows;
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    setupDatabase: async () => {
        try {
            await database.runQuery(`
                CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT,
                discriminator TEXT,
                email TEXT,
                password TEXT,
                token TEXT,
                verified INTEGER DEFAULT 0,
                created_at TEXT DEFAULT NULL,
                avatar TEXT DEFAULT NULL,
                bot INTEGER DEFAULT 0,
                relationships TEXT DEFAULT '[]',
                flags INTEGER DEFAULT 0,
                private_channels TEXT DEFAULT '[]',
                settings TEXT DEFAULT '{"show_current_game":false,"inline_attachment_media":true,"inline_embed_media":true,"render_embeds":true,"render_reactions":true,"sync":true,"theme":"dark","enable_tts_command":true,"message_display_compact":false,"locale":"en-US","convert_emoticons":true,"restricted_guilds":[],"allow_email_friend_request":false,"friend_source_flags":{"all":true},"developer_mode":true,"guild_positions":[],"detect_platform_accounts":false,"status":"online"}',
                guild_settings TEXT DEFAULT '[]',
                disabled_until TEXT DEFAULT NULL,
                disabled_reason TEXT DEFAULT NULL
           );`, []); // 4 = Everyone, 3 = Friends of Friends & Server Members, 2 = Friends of Friends, 1 = Server Members, 0 = No one

           //[{id, open, recipients, group_dm}]

           await database.runQuery(`
            CREATE TABLE IF NOT EXISTS staff (
                user_id TEXT,
                privilege INTEGER DEFAULT 1,
                audit_log TEXT DEFAULT '[]'
            );`, []); //PRIVILEGE: 1 - (JANITOR) [Can only flag things for review], 2 - (MODERATOR) [Can only delete messages, mute users, and flag things for review], 3 - (ADMIN) [Free reign, can review flags, disable users, delete servers, etc], 4 - (INSTANCE OWNER) - [Can add new admins, manage staff, etc]

            await database.runQuery(`
            CREATE TABLE IF NOT EXISTS connected_accounts (
                user_id TEXT,
                account_id TEXT,
                username TEXT,
                visibility INTEGER DEFAULT 0,
                friendSync INTEGER DEFAULT 1,
                integrations TEXT DEFAULT '[]',
                revoked INTEGER DEFAULT 0,
                connected_at TEXT DEFAULT NULL,
                platform TEXT DEFAULT NULL
           );`, []);

            await database.runQuery(`
            CREATE TABLE IF NOT EXISTS channels (
                id TEXT,
                type INTEGER DEFAULT 0,
                guild_id TEXT,
                topic TEXT DEFAULT NULL,
                last_message_id TEXT DEFAULT '0',
                permission_overwrites TEXT,
                name TEXT,
                recipients TEXT DEFAULT '[]',
                nsfw INTEGER DEFAULT 0,
                position INTEGER DEFAULT 0
           );`, []); //type 0, aka "text", 1 for "dm", 2 for "voice" - and so on and so forth

            await database.runQuery(`
            CREATE TABLE IF NOT EXISTS permissions (
                channel_id TEXT,
                overwrite TEXT DEFAULT NULL
           );`, []);

            await database.runQuery(`
            CREATE TABLE IF NOT EXISTS guilds (
                id TEXT PRIMARY KEY,
                name TEXT,
                icon TEXT DEFAULT NULL,
                splash TEXT DEFAULT NULL,
                region TEXT DEFAULT NULL,
                owner_id TEXT,
                afk_channel_id TEXT,
                afk_timeout INTEGER DEFAULT 300,
                creation_date TEXT,
                exclusions TEXT DEFAULT '[]',
                custom_emojis TEXT DEFAULT '[]',
                webhooks TEXT DEFAULT '[]',
                features TEXT DEFAULT '[]',
                vanity_url TEXT DEFAULT NULL,
                default_message_notifications INTEGER DEFAULT 0,
                verification_level INTEGER DEFAULT 0
           );`, []);

            await database.runQuery(`
            CREATE TABLE IF NOT EXISTS roles (
                guild_id TEXT,
                role_id TEXT,
                name TEXT,
                hoist INTEGER DEFAULT 0,
                color INTEGER DEFAULT 0,
                mentionable INTEGER DEFAULT 0,
                permissions INTEGER DEFAULT 104193089,
                position INTEGER DEFAULT 0
           );`, []);

            await database.runQuery(`
            CREATE TABLE IF NOT EXISTS members (
                guild_id TEXT,
                user_id TEXT,
                nick TEXT DEFAULT NULL,
                roles TEXT DEFAULT NULL,
                joined_at TEXT DEFAULT NULL,
                deaf INTEGER DEFAULT 0,
                mute INTEGER DEFAULT 0
           );`, []);

            await database.runQuery(`
            CREATE TABLE IF NOT EXISTS invites (
                guild_id TEXT,
                channel_id TEXT,
                code TEXT,
                temporary INTEGER DEFAULT 0,
                revoked INTEGER DEFAULT 0,
                inviter_id TEXT,
                uses INTEGER DEFAULT 0,
                maxUses INTEGER DEFAULT 0,
                maxAge INTEGER DEFAULT 0,
                xkcdpass INTEGER DEFAULT 0,
                createdAt TEXT
           );`, []);

            await database.runQuery(`CREATE TABLE IF NOT EXISTS messages (
                guild_id TEXT,
                message_id TEXT,
                channel_id TEXT,
                author_id TEXT,
                content TEXT,
                edited_timestamp TEXT DEFAULT NULL,
                mention_everyone INTEGER DEFAULT 0,
                nonce TEXT,
                timestamp TEXT,
                tts INTEGER DEFAULT 0,
                embeds TEXT DEFAULT '[]',
                reactions TEXT DEFAULT '[]',
                pinned INTEGER DEFAULT 0,
                overrides TEXT DEFAULT NULL
           );`, []);

            await database.runQuery(`CREATE TABLE IF NOT EXISTS acknowledgements (
                user_id TEXT,
                channel_id TEXT,
                message_id TEXT,
                timestamp TEXT,
                mention_count INTEGER DEFAULT 0
           );`, []);

            await database.runQuery(`CREATE TABLE IF NOT EXISTS attachments (
                attachment_id TEXT,
                message_id TEXT,
                filename TEXT,
                height INTEGER,
                width INTEGER,
                size INTEGER,
                url TEXT
           );`, []);

            await database.runQuery(`CREATE TABLE IF NOT EXISTS widgets (
                guild_id TEXT,
                channel_id TEXT DEFAULT NULL,
                enabled INTEGER DEFAULT 0
           );`, []);

            await database.runQuery(`CREATE TABLE IF NOT EXISTS bans (
                guild_id TEXT,
                user_id TEXT
           );`, []);

           await database.runQuery(`CREATE TABLE IF NOT EXISTS webhooks (
                guild_id TEXT,
                channel_id TEXT,
                id TEXT,
                token TEXT,
                avatar TEXT DEFAULT NULL,
                name TEXT DEFAULT 'Captain Hook',
                creator_id TEXT
            );`, []);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    createPrivateChannel: async (owner, handle_recipients, dont_add_for_them) => {
        try {
            let recipients = [];

            for(var recipient of handle_recipients) {
                recipients.push({
                    ...globalUtils.miniUserObject(recipient),
                    owner: false
                }); 
            }

            recipients.push({
                ...globalUtils.miniUserObject(owner),
                owner: true
            })

            let channel = await database.createChannel(null, null, 0, 0, recipients);

            if (!channel) {
                return null;
            }

            if (!dont_add_for_them) {
                for(var recipient of recipients) {
                    let priv_channels = await database.getPrivateChannels(recipient.id);
    
                    if (!priv_channels || priv_channels.find(x => x.id == owner.id)) continue;
    
                    priv_channels.push({
                        id: channel.id,
                        open: false
                    });

                    await database.setPrivateChannels(recipient.id, priv_channels);
                }
            }

            let ourPrivateChannels = await database.getPrivateChannels(owner.id);

            if (!ourPrivateChannels) return null;
            
            ourPrivateChannels.push({
                id: channel.id,
                open: true
            });

            await database.setPrivateChannels(owner.id, ourPrivateChannels);
            
            for(var recipient of channel.recipients) {
                delete recipient.owner;
            }

            channel.recipients = channel.recipients.filter(x => x.id !== owner.id);

            return channel;
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    setPrivateChannels: async (user_id, private_channels) => {
        try {
            await database.runQuery(`
                UPDATE users SET private_channels = $1 WHERE id = $2
            `, [JSON.stringify(private_channels), user_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    getPrivateChannels: async (user_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM users WHERE id = $1
            `, [user_id]);

            let ret = [];

            if (rows == null || rows.length == 0) {
                return [];
            }

            let chans = JSON.parse(rows[0].private_channels);

            if (chans && chans.length > 0) {
                for(var chan of chans) {
                    let actual_channel = await database.getChannelById(chan.id);

                    if (!actual_channel) continue;
    
                    let recipients = actual_channel.recipients; //people in the channel, user objects

                    ret.push({
                        guild_id: null,
                        id: chan.id,
                        type: actual_channel.type,
                        last_message_id: actual_channel.last_message_id ?? "0",
                        recipients: recipients ?? [],
                        open: chan.open
                    });
                }

                return ret;
            } else return [];
        } catch (error) {  
            logText(error, "error");

            return [];
        }
    },
    getLatestAcknowledgement: async (user_id, channel_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM acknowledgements WHERE user_id = $1 AND channel_id = $2 ORDER BY timestamp DESC LIMIT 1
            `, [user_id, channel_id]);

            if (rows == null || rows.length == 0) {
                return null;
            }

            return {
                id: rows[0].channel_id,
                mention_count: rows[0].mention_count,
                last_message_id: rows[0].message_id
            };
        }
        catch (error) {
            logText(error, "error");

            return null;
        }
    },
    getStaffDetails: async (user_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM staff WHERE user_id = $1
            `, [user_id]);

            if (rows == null || rows.length == 0) {
                return null;
            }

            return {
                user_id: rows[0].user_id,
                privilege: rows[0].privilege,
                audit_log: JSON.parse(rows[0].audit_log) ?? []
            };
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    isMessageAcked: async (user_id, channel_id, message_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM acknowledgements WHERE user_id = $1 AND channel_id = $2 AND message_id = $3
            `, [user_id, channel_id, message_id]);

            if (rows == null || rows.length == 0) {
                return false;
            }

            return true;
        }  catch (error) {
            logText(error, "error");

            return false;
        }
    },
    acknowledgeMessage: async (user_id, channel_id, message_id, mention_count) => {
        try {
            const date = new Date().toISOString();

            await database.runQuery(`
                INSERT INTO acknowledgements (user_id, channel_id, message_id, mention_count, timestamp) VALUES ($1, $2, $3, $4, $5)
            `, [user_id, channel_id, message_id, mention_count, date]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    getUsersGuildSettings: async (user_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM users WHERE id = $1
            `, [user_id]);

            if (rows != null && rows.length > 0) {
                return JSON.parse(rows[0].guild_settings);
            } else {
                return null;
            }
        } catch (error) {  
            logText(error, "error");

            return null;
        }
    },
    setUsersGuildSettings: async (user_id, new_settings) => {
        try {
            await database.runQuery(`UPDATE users SET guild_settings = $1 WHERE id = $2`, [JSON.stringify(new_settings), user_id]);

            return true;
        } catch (error) {  
            logText(error, "error");

            return false;
        }
    },
    getAccountByEmail: async (email) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM users WHERE email = $1
            `, [email]);

            return globalUtils.prepareAccountObject(rows, []); //relationships arent even accessed from here either
        } catch (error) {  
            logText(error, "error");

            return null;
        }
    },
    //temp fix for a memory leak, im going to redo this entire db wrapper one day.
    getRelationshipUserById: async (id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM users WHERE id = $1
            `, [id]);

            if (rows === null || rows.length === 0) {
                return null;
            }

            return {
                id: rows[0].id,
                username: rows[0].username,
                discriminator: rows[0].discriminator,
                avatar: rows[0].avatar == 'NULL' ? null : rows[0].avatar,
                premium: true,
                flags: rows[0].flags ?? 0,
                bot: rows[0].bot == 1 ? true : false
            };
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    getAccountByToken: async (token) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM users WHERE token = $1
            `, [token]);

            let contents = JSON.parse(rows[0].relationships);
            let relationships = [];
            
            if (contents && contents.length > 0) {
                for (var relationship of contents) {
                    let user = await global.database.getRelationshipUserById(relationship.id);

                    if (user && user.id != rows[0].id) {
                        relationships.push({
                            id: relationship.id,
                            type: relationship.type,
                            user: user
                        })
                    }
                }
            }

            return globalUtils.prepareAccountObject(rows, relationships);
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    getAccountByUsernameTag: async (username, discriminator) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM users WHERE username = $1 AND discriminator = $2
            `, [username, discriminator]);

            return globalUtils.prepareAccountObject(rows, []); //dont care about this, relationships arent even accessed from here
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    getAccountsByUsername: async (username) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM users WHERE username = $1
            `, [username]);

            if (rows === null || rows.length === 0) {
                return [];
            }

            let ret = [];

            if (Array.isArray(rows)) {
                for(var row of rows) {
                    ret.push({
                        id: row.id,
                        username: row.username,
                        discriminator: row.discriminator,
                        avatar: row.avatar == 'NULL' ? null : row.avatar,
                        email: row.email,
                        password: row.password,
                        token: row.token,
                        verified: true,
                        flags: row.flags ?? 0,
                        bot: row.bot == 1 ? true : false,
                        created_at: row.created_at,
                        settings: JSON.parse(row.settings)
                    })
                }
            } else {
                const row = rows[0];

                ret.push({
                        id: row.id,
                        username: row.username,
                        discriminator: row.discriminator,
                        avatar: row.avatar == 'NULL' ? null : row.avatar,
                        email: row.email,
                        password: row.password,
                        token: row.token,
                        verified: true,
                        flags: row.flags ?? 0,
                        bot: row.bot == 1 ? true : false,
                        created_at: row.created_at,
                        settings: JSON.parse(row.settings)
                    })
            }
            

            return ret;
        } catch (error) {  
            logText(error, "error");

            return [];
        }
    },
    getAccountByUserId: async (id) => {
        try {
            if (id.startsWith("WEBHOOK_")) {
                let webhookId = id.split('_')[1];
                let webhook = await database.getWebhookById(webhookId);

                if (!webhook) return null;

                return {
                    username: webhook.name,
                    discriminator: "0000",
                    id: webhookId,
                    bot: true,
                    webhook: true,
                    avatar: null
                }
            }

            const rows = await database.runQuery(`
                SELECT * FROM users WHERE id = $1
            `, [id]);

            let contents = JSON.parse(rows[0].relationships);
            let relationships = [];
            
            if (contents && contents.length > 0) {
                for (var relationship of contents) {
                    let user = await global.database.getRelationshipUserById(relationship.id);

                    if (!user || user.id === id) continue;

                    relationships.push({
                        id: relationship.id,
                        type: relationship.type,
                        user: user
                    })
                }
            }

            return globalUtils.prepareAccountObject(rows, relationships);
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    banMember: async (guild_id, user_id) => {
        try {
            await database.runQuery(`
                INSERT INTO bans (guild_id, user_id) VALUES ($1, $2)
            `, [guild_id, user_id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    unbanMember: async (guild_id, user_id) => {
        try {
            await database.runQuery(`
                DELETE FROM bans WHERE guild_id = $1 AND user_id = $2
            `, [guild_id, user_id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    createCustomEmoji: async (guild, user_id, emoji_id, emoji_name) => {
        try {
            let user = await database.getAccountByUserId(user_id);

            if (user == null) {
                return false;
            }

            let custom_emojis = guild.emojis;

            custom_emojis.push({
                id: emoji_id,
                name: emoji_name,
                user: globalUtils.miniUserObject(user)
            });

            await database.runQuery(`UPDATE guilds SET custom_emojis = $1 WHERE id = $2`, [JSON.stringify(custom_emojis), guild.id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    updateCustomEmoji: async (guild, emoji_id, new_name) => {
        try {
            let custom_emojis = guild.emojis;

            let customEmoji = custom_emojis.find(x => x.id == emoji_id);

            if (!customEmoji) {
                return false;
            }

            customEmoji.name = new_name;

            await database.runQuery(`UPDATE guilds SET custom_emojis = $1 WHERE id = $2`, [JSON.stringify(custom_emojis), guild.id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    deleteCustomEmoji: async (guild, emoji_id) => {
        try {
            let custom_emojis = guild.emojis;

            custom_emojis = custom_emojis.filter(x => x.id != emoji_id);

            await database.runQuery(`UPDATE guilds SET custom_emojis = $1 WHERE id = $2`, [JSON.stringify(custom_emojis), guild.id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    updateWebhook: async (webhook_id, channel_id, name, avatar = null) => {
        try {
            if (!channel_id) {
                channel_id = guild.id; //default channel fallback
            }

            if (!name) {
                name = "Captain Hook"; //no name fallback
            }

            avatar = 'NULL';

            if (avatar != null && avatar.includes("data:image/")) {
                var extension = avatar.split('/')[1].split(';')[0];
                var imgData = avatar.replace(`data:image/${extension};base64,`, "");
                var name = Math.random().toString(36).substring(2, 15) + Math.random().toString(23).substring(2, 5);
                var name_hash = md5(name);

                if (extension == "jpeg") {
                    extension = "jpg";
                }

                avatar = name_hash;
    
                if (!fs.existsSync(`./www_dynamic/avatars/${webhook_id}`)) {
                    fs.mkdirSync(`./www_dynamic/avatars/${webhook_id}`, { recursive: true });
                }
 
                fs.writeFileSync(`./www_dynamic/avatars/${webhook_id}/${name_hash}.${extension}`, imgData, "base64");
            }

            await database.runQuery(`UPDATE webhooks SET channel_id = $1, name = $2, avatar = $3 WHERE id = $4`, [channel_id, name, avatar, webhook_id]);

            let webhook = await database.getWebhookById(webhook_id);

            if (!webhook) {
                return false;
            }

            return webhook;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    deleteWebhook: async (webhook_id) => {
        try {
            await database.runQuery(`DELETE FROM webhooks WHERE id = $1`, [webhook_id]);
           
            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    createWebhook: async (guild, user, channel_id, name, avatar) => {
        try {
            let webhook_id = Snowflake.generate();
            let avatarHash = null;

            if (avatar != null && avatar.includes("data:image/")) {
                var extension = avatar.split('/')[1].split(';')[0];
                var imgData = avatar.replace(`data:image/${extension};base64,`, "");
                var name = Math.random().toString(36).substring(2, 15) + Math.random().toString(23).substring(2, 5);
                var name_hash = md5(name);

                avatarHash = name_hash;
    
                if (extension == "jpeg") {
                    extension = "jpg";
                }

                if (!fs.existsSync(`./www_dynamic/avatars/${webhook_id}`)) {
                    fs.mkdirSync(`./www_dynamic/avatars/${webhook_id}`, { recursive: true });
                }
 
                fs.writeFileSync(`./www_dynamic/avatars/${webhook_id}/${name_hash}.${extension}`, imgData, "base64");
            }

            let token = globalUtils.generateString(60);

            await database.runQuery(`INSERT INTO webhooks (guild_id, channel_id, id, token, avatar, name, creator_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [guild.id, channel_id, webhook_id, token, avatarHash == null ? 'NULL' : avatarHash, name, user.id]);
            
            return {
                application_id: null,
                id: webhook_id,
                token: token,
                avatar: avatarHash,
                name: name,
                channel_id: channel_id,
                guild_id: guild.id,
                type: 1,
                user: globalUtils.miniUserObject(user)
            }
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    getWebhookById: async (webhook_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM webhooks WHERE id = $1
            `, [webhook_id]);

            if (rows != null && rows.length > 0) {
                let row = rows[0];

                let webhookAuthor = await database.getAccountByUserId(row.creator_id);

                if (!webhookAuthor) {
                    return null;
                }

                return {
                    guild_id: row.guild_id,
                    channel_id: row.channel_id,
                    id: row.id,
                    token: row.token,
                    avatar: row.avatar == 'NULL' ? null : row.avatar,
                    name: row.name,
                    user: globalUtils.miniUserObject(webhookAuthor),
                    type: 1,
                    application_id: null
                };
            } else {
                return null;
            }
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    getConnectedAccounts: async (user_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM connected_accounts WHERE user_id = $1
            `, [user_id]);

            if (rows != null && rows.length > 0) {
                const ret = [];

                for(var row of rows) {
                    ret.push({
                        id: row.account_id,
                        type: row.platform,
                        name: row.username,
                        revoked: row.revoked,
                        integrations: JSON.parse(row.integrations) ?? [],
                        visibility: row.visibility,
                        friendSync: row.friendSync
                    })
                }

                return ret;
            } else {
                return [];
            }
        } catch (error) {
            logText(error, "error");

            return [];
        }
    },
    getConnectionById: async (account_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM connected_accounts WHERE account_id = $1
            `, [account_id]);

            if (rows != null && rows.length > 0) {
                return {
                    id: rows[0].account_id,
                    type: rows[0].platform,
                    name: rows[0].username,
                    revoked: rows[0].revoked,
                    integrations: JSON.parse(rows[0].integrations) ?? [],
                    visibility: rows[0].visibility,
                    friendSync: rows[0].friendSync
                };
            } else {
                return null;
            }
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    updateConnectedAccount: async (connection_id, visibility, friendSync = true, integrations = [], revoked = false) => {
        try {
            const connection = await database.getConnectionById(connection_id);

            if (connection == null) {
                return false;
            }

            await database.runQuery(`UPDATE connected_accounts SET visibility = $1, friendSync = $2, integrations = $3, revoked = $4 WHERE account_id = $5`, [visibility == true ? 1 : 0, friendSync == true ? 1 : 0, JSON.stringify(integrations), revoked == true ? 1 : 0, connection_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    removeConnectedAccount: async (connection_id) => {
        try {
            const connection = await database.getConnectionById(connection_id);

            if (connection == null) {
                return false;
            }

            await database.runQuery(`DELETE FROM connected_accounts WHERE account_id = $1`, [connection_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    addConnectedAccount: async (user_id, platform, id, username) => {
        try {
            const date = new Date().toISOString();

            await database.runQuery(`INSERT INTO connected_accounts (user_id, account_id, username, connected_at, platform) VALUES ($1, $2, $3, $4, $5)`, [user_id, id, username, date, platform]);

            return true;
        }
        catch (error) {
           logText(error, "error");
            
            return false;
        }
    },
    getRelationshipsByUserId: async(user_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM users WHERE id = $1
            `, [user_id]);

            if (rows === null || rows.length === 0) {
                return [];
            }

            let ret = [];

            let contents = JSON.parse(rows[0].relationships);
            
            if (contents && contents.length > 0) {
                for(var relationship of contents) {
                    let user = await database.getRelationshipUserById(relationship.id);

                    if (!user || user.id === user_id) continue;

                    ret.push({
                        id: relationship.id,
                        type: relationship.type,
                        user: user
                    })
                }

                return ret;
            } else return [];
        } catch (error) {
            logText(error, "error");

            return [];
        }
    },
    modifyRelationships: async (user_id, relationships) => {
        try {   
            await database.runQuery(`UPDATE users SET relationships = $1 WHERE id = $2`, [JSON.stringify(relationships), user_id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    getGuildBans: async (id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM bans WHERE guild_id = $1
            `, [id]);
    
            if (rows != null && rows.length > 0) {
                const ret = [];

                for(var row of rows) {
                    const user = await database.getAccountByUserId(row.user_id);

                    if (user != null) {
                        ret.push({
                            user: globalUtils.miniUserObject(user)
                        });
                    }
                }

                return ret;
            } else {
                return [];
            }
        } catch (error) {
            logText(error, "error");
    
            return [];
        }
    },
    addMessageReaction: async (message, user_id, emoji_id, emoji_name) => {
        try {
            let reactions = message.reactions;

            if (reactions.find(x => x.user_id == user_id && x.emoji.id == emoji_id && x.emoji.name == emoji_name)) {
                reactions = reactions.filter(x => !(x.user_id == user_id && x.emoji.id === emoji_id && x.emoji.name === emoji_name));
            }

            reactions.push({
                user_id: user_id,
                emoji: {
                    id: emoji_id,
                    name: emoji_name
                }
            });

            await database.runQuery(`UPDATE messages SET reactions = $1 WHERE message_id = $2`, [JSON.stringify(reactions), message.id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    removeMessageReaction: async (message, user_id, emoji_id, emoji_name) => {
        try {
            let reactions = message.reactions;

            reactions = reactions.filter(x => !(x.user_id == user_id && x.emoji.id === emoji_id && x.emoji.name === emoji_name));

            await database.runQuery(`UPDATE messages SET reactions = $1 WHERE message_id = $2`, [JSON.stringify(reactions), message.id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    createChannel: async (guild_id, name, type, position, recipients = []) => {
        try {
            const channel_id = Snowflake.generate();

            if (guild_id === null && recipients.length > 0) {
                //create dm channel / group dm

                await database.runQuery(`INSERT INTO channels (id, type, guild_id, topic, last_message_id, permission_overwrites, name, position, recipients) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [channel_id, recipients.length > 2 ? 3 : 1, 'NULL', 'NULL', '0', 'NULL', 'NULL', 0, JSON.stringify(recipients)]);

                return {
                    id: channel_id,
                    guild_id: null,
                    type: recipients.length > 2 ? 3 : 1,
                    last_message_id: "0",
                    recipients: recipients ?? []
                };
            }

            await database.runQuery(`INSERT INTO channels (id, type, guild_id, topic, last_message_id, permission_overwrites, name, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [channel_id, type, guild_id, 'NULL', '0', 'NULL', name, 0])

            return {
                id: channel_id,
                name: name,
                guild_id: guild_id,
                type: type,
                topic: null,
                nsfw: false,
                last_message_id: "0",
                permission_overwrites: [],
                position: position
            };
        } catch(error) {
            logText(error, "error");

            return null;
        }
    },
    updateGuildMemberNick: async (guild_id, member_id, new_nick) => {
        try {
            let nick = new_nick == null || new_nick.length > 20 ? 'NULL' : new_nick;

            await database.runQuery(`UPDATE members SET nick = $1 WHERE guild_id = $2 AND user_id = $3`, [nick, guild_id, member_id]);

            return true;    
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    updateChannel: async (channel_id, channel) => {
        try {
            let overwrites  = 'NULL';

            if (channel.permission_overwrites) {
                let out = globalUtils.SerializeOverwritesToString(channel.permission_overwrites);

                if (out != null) {
                    overwrites = out;
                }
            }

            await database.runQuery(`UPDATE channels SET last_message_id = $1, name = $2, topic = $3, nsfw = $4, permission_overwrites = $5, position = $6 WHERE id = $7`, [channel.last_message_id, channel.name, channel.topic, channel.nsfw ? 1 : 0, overwrites, channel.position, channel_id]);

            return true;    
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    getUsersMessagesInGuild: async (guild_id, author_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM messages WHERE author_id = $1 AND guild_id = $2
            `, [author_id, guild_id]);

            if (rows == null || rows.length == 0) {
                return [];
            }

            const ret = [];

            for(var row of rows) {
                const message = await database.getMessageById(row.message_id);

                if (message != null) {
                    ret.push(message);
                }
            }

            return ret;
        } catch (error) {
            logText(error, "error");

            return [];
        }
    },
    getMessageById: async (id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM messages WHERE message_id = $1
            `, [id]);

            if (rows == null || rows.length == 0) {
                return null;
            }

            const author = await database.getAccountByUserId(rows[0].author_id);

            if (author == null) {
                return null;
            }

            const mentions = [];
            const mention_ids = [];

            if (rows[0].content.includes("<@")) {
                const regex = /<@(\d+)>/g;

                let match = null;

                while ((match = regex.exec(rows[0].content))) {
                    if (match != null) {
                        mention_ids.push(match[1]);
                    }
                }
            }

            if (mention_ids.length > 0) {
                for(var mention_id of mention_ids) {
                    const mention = await database.getAccountByUserId(mention_id);

                    if (mention != null) {
                        mentions.push(globalUtils.miniUserObject(mention));
                    }
                }
            }

            const attachments = await database.runQuery(`
                SELECT * FROM attachments WHERE message_id = $1
            `, [id]);

            const messageAttachments = [];

            if (attachments != null && attachments.length > 0) {
                for(var attachment of attachments) {
                    messageAttachments.push({
                        filename: attachment.filename,
                        height: attachment.height,
                        width: attachment.width,
                        id: attachment.attachment_id,
                        proxy_url: attachment.url,
                        url: attachment.url,
                        size: attachment.size
                    })
                }
            }

            const reactionRet = [];
            const msgReactions = JSON.parse(rows[0].reactions);

            for (var row of msgReactions) {
                reactionRet.push({
                    user_id: row.user_id,
                    emoji: row.emoji
                });
            }

            return {
                id: rows[0].message_id,
                content: rows[0].content,
                channel_id: rows[0].channel_id,
                author: globalUtils.miniUserObject(author),
                attachments: messageAttachments,
                embeds: rows[0].embeds == 'NULL' ? [] : JSON.parse(rows[0].embeds),
                mentions: mentions,
                mention_everyone: rows[0].mention_everyone == 1,
                nonce: rows[0].nonce,
                edited_timestamp: rows[0].edited_timestamp == 'NULL' ? null : rows[0].edited_timestamp,
                timestamp: rows[0].timestamp,
                mention_roles: [],
                reactions: reactionRet,
                tts: rows[0].tts == 1,
                pinned: rows[0].pinned == 1,
                overrides: (!rows[0].overrides ? null : rows[0].overrides == 'NULL' ? null : JSON.parse(rows[0].overrides))
            }
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    getPinnedMessagesInChannel: async (channel_id) => {
        try {
            const rows = await database.runQuery(`SELECT * FROM messages WHERE channel_id = $1 AND pinned = $2`, [channel_id, 1]);
           
            if (rows == null || rows.length == 0) {
                return [];
            }

            const ret = [];

            for (const row of rows) {
                const message = await database.getMessageById(row.message_id);

                if (message != null) {
                    ret.push(message);
                }
            }

            return ret;
        } catch (error) {
            logText(error, "error");

            return [];
        }
    },
    //to-do add role mention support
    getRecentMentions: async (user_id, before_id, limit, include_roles, include_everyone_mentions, guild_id) => {
        try {
            let query = `SELECT * FROM messages WHERE `;
            const params = [];
            let paramIndex = 1;

            if (guild_id) {
                query += `guild_id = $${paramIndex} AND `;

                params.push(guild_id);

                paramIndex++;
            }

            if (before_id) {
                query += `message_id < $${paramIndex} AND `;

                params.push(before_id);

                paramIndex++;
            }
    
            query += `(content LIKE '%<@${user_id}>%'`;
    
            if (include_everyone_mentions) {
                query += ` OR mention_everyone = 1`;
            }
    
            query += `) `;
    

            query += `ORDER BY timestamp DESC LIMIT $${paramIndex}`;

            params.push(limit);
    
            const rows = await database.runQuery(query, params);
    
            if (!rows || rows.length === 0) {
                return [];
            }
    
            const ret = [];
    
            for (const row of rows) {
                const message = await database.getMessageById(row.message_id);

                if (message != null) {
                    ret.push(message);
                }
            }
    
            return ret;
        } catch (error) {
            logText(error, "error");
            return [];
        }
    },
    getChannelMessages: async (id, limit, before_id, after_id, includeReactions) => {
        try {
            let query = `SELECT * FROM messages WHERE channel_id = $1 `;
            const params = [id];

            if (before_id && after_id) {
                query += 'AND message_id < $2 AND message_id > $3 ORDER BY timestamp DESC LIMIT $4';
                params.push(before_id, after_id, limit);
            } else if (before_id) {
                query += 'AND message_id < $2 ORDER BY timestamp DESC LIMIT $3';
                params.push(before_id, limit);
            } else if (after_id) {
                query += 'AND message_id > $2 ORDER BY timestamp DESC LIMIT $3';
                params.push(after_id, limit);
            } else {
                query += 'ORDER BY timestamp DESC LIMIT $2';
                params.push(limit);
            }

            const rows = await database.runQuery(query, params);

            if (rows == null || rows.length == 0) {
                return [];
            }

            const ret = [];

            for (const row of rows) {
                const message = await database.getMessageById(row.message_id);
                
                if (includeReactions) {
                    const reactions = message.reactions;
                    const fixedReactions = [];

                    const reactionMap = reactions.reduce((acc, reaction) => {
                        const { id, name } = reaction.emoji;
                        const key = id || name;
                    
                        if (!acc[key]) {
                            acc[key] = { 
                                emoji: { id, name },
                                count: 0,
                                user_ids: new Set()
                            };
                        }
                    
                        acc[key].count++;
                        acc[key].user_ids.add(reaction.user_id);
                    
                        return acc;
                    }, {});
          
                    for (const key in reactionMap) {
                        fixedReactions.push({
                            emoji: reactionMap[key].emoji,
                            count: reactionMap[key].count,
                            user_ids: Array.from(reactionMap[key].user_ids),
                            me: false
                        });
                    }

                    message.reactions = fixedReactions;
                }

                if (message != null) {
                    ret.push(message);
                }
            }

            return ret;
        } catch (error) {
            logText(error, "error");

            return [];
        }
    },
    getChannelById: async (id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM channels WHERE id = $1
            `, [id]);

            if (rows === null || rows.length === 0) {
                return null;
            }

            const row = rows[0];

            if (row.guild_id === 'NULL') {
                //dm channel / group dm

                return {
                    id: row.id,
                    guild_id: null,
                    type: row.type,
                    last_message_id: row.last_message_id ?? "0",
                    recipients: JSON.parse(row.recipients)
                }
            }

            let overwrites = [];

            if (row.permission_overwrites && row.permission_overwrites.includes(":")) {
                for (var overwrite of row.permission_overwrites.split(':')) {
                    let role_id = overwrite.split('_')[0];
                    let allow_value = overwrite.split('_')[1];
                    let deny_value = overwrite.split('_')[2];

                    overwrites.push({
                        id: role_id,
                        allow: parseInt(allow_value),
                        deny: parseInt(deny_value),
                        type: overwrite.split('_')[3] ? overwrite.split('_')[3] : 'role'
                    });
                }
            } else if (row.permission_overwrites && row.permission_overwrites != "NULL") {
                let overwrite = rows[0].permission_overwrites;
                let role_id = overwrite.split('_')[0];
                let allow_value = overwrite.split('_')[1];
                let deny_value = overwrite.split('_')[2];

                overwrites.push({
                    id: role_id,
                    allow: parseInt(allow_value),
                    deny: parseInt(deny_value),
                    type: overwrite.split('_')[3] ? overwrite.split('_')[3] : 'role'
                });
            }

            return {
                id: row.id,
                name: row.name,
                guild_id: row.guild_id == 'NULL' ? null : row.guild_id,
                type: parseInt(row.type),
                topic: row.topic == 'NULL' ? null : row.topic,
                last_message_id: row.last_message_id ?? "0",
                permission_overwrites: overwrites,
                nsfw: row.nsfw == 1 ?? false,
                position: row.position
            }
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    getGuildsByName: async (name) => {
        try {
            const rows = await database.runQuery(`
            SELECT * FROM guilds WHERE name ILIKE $1
            `, [`%${name}%`]);

            if (rows == null || rows.length == 0) {
                return [];
            }

            let ret = [];

            for(var row of rows) {
                let guild = await database.getGuildById(row.id);

                ret.push(guild);
            }

            return ret;
        } catch (error) {
            logText(error, "error");

            return [];
        }
    },
    getGuildById: async (id) => {
        const rows = await database.runQuery(`
                SELECT * FROM guilds WHERE id = $1
        `, [id]);

        try {
            if (rows === null || rows.length === 0) {
                return null;
            }

            //#region Channels Logic
            const channelRows = await database.runQuery(`
                SELECT * FROM channels WHERE guild_id = $1
            `, [id]);

            if (channelRows === null || channelRows.length === 0) {
                return null;
            }

            let channels = [];

            for (var row of channelRows) {
                if (!row) continue;
    
                let overwrites = [];    
    
                if (row.permission_overwrites && row.permission_overwrites.includes(":")) {
                    for (var overwrite of row.permission_overwrites.split(':')) {
                        let role_id = overwrite.split('_')[0];
                        let allow_value = overwrite.split('_')[1];
                        let deny_value = overwrite.split('_')[2];
    
                        overwrites.push({
                            id: role_id,
                            allow: parseInt(allow_value),
                            deny: parseInt(deny_value),
                            type: overwrite.split('_')[3] ? overwrite.split('_')[3] : 'role'
                        });
                    }
                } else if (row.permission_overwrites && row.permission_overwrites != "NULL") {
                    let overwrite = row.permission_overwrites;
                    let role_id = overwrite.split('_')[0];
                    let allow_value = overwrite.split('_')[1];
                    let deny_value = overwrite.split('_')[2];
    
                    overwrites.push({
                        id: role_id,
                        allow: parseInt(allow_value),
                        deny: parseInt(deny_value),
                        type: overwrite.split('_')[3] ? overwrite.split('_')[3] : 'role'
                    });
                }
    
                channels.push({
                    id: row.id,
                    name: row.name,
                    guild_id: row.guild_id == 'NULL' ? null : row.guild_id,
                    type: parseInt(row.type),
                    topic: row.topic == 'NULL' ? null : row.topic,
                    nsfw: row.nsfw == 1 ?? false,
                    last_message_id: row.last_message_id,
                    permission_overwrites: overwrites,
                    position: row.position
                })
            }

            //#endregion

            //#region Roles Logic

            const roleRows = await database.runQuery(`
                SELECT * FROM roles WHERE guild_id = $1
            `, [id]);

            if (roleRows === null || roleRows.length === 0) {
                return null;
            }

            let roles = [];

            for(var row of roleRows) {
                roles.push({
                    id: row.role_id,
                    name: row.name,
                    permissions: row.permissions,
                    position: row.position,
                    color: row.color,
                    hoist: row.hoist == 1,
                    mentionable: row.mentionable == 1
                });
            }

            //#endregion

            //#region Guild Members Logic

            const memberRows = await database.runQuery(`
                SELECT * FROM members WHERE guild_id = $1
            `, [id]);

            if (memberRows === null || memberRows.length === 0) {
                return null;
            }

            let members = [];

            for (var row of memberRows) {
                let member_roles = [];

                if (row.roles.includes(':')) {
                    const db_roles = row.roles.split(':');

                    for (var db_role of db_roles) {
                        if (roles.find(x => x.id === db_role)) {
                            member_roles.push(db_role);
                        }
                    }
                } else {
                    if (roles.find(x => x.id === row.roles)) {
                        member_roles.push(row.roles);
                    }
                }

                const user = await database.getAccountByUserId(row.user_id);

                if (user == null) {
                    continue;
                }

                member_roles = member_roles.filter(x => x !== id); //exclude @ everyone just in case

                members.push({
                    id: user.id,
                    nick: row.nick == 'NULL' ? null : row.nick,
                    deaf: ((row.deaf == 'TRUE' || row.deaf == 1) ? true : false),
                    mute: ((row.mute == 'TRUE' || row.mute == 1) ? true : false),
                    roles: member_roles,
                    user: globalUtils.miniUserObject(user)
                })
            }

            //#endregion

            //#region Custom Emojis Logic

            let emojis = JSON.parse(rows[0].custom_emojis); //???

            for (var emoji of emojis) {
                emoji.roles = [];
                emoji.require_colons = true;
                emoji.managed = false;
                emoji.allNamesString = `:${emoji.name}:`
            }

            //#endregion

            //#region Guild Presences Logic

            let presences = [];

            for(var member of members) {
                let sessions = global.userSessions.get(member.id);

                if (global.userSessions.size === 0 || !sessions) {
                    presences.push({                             
                        game_id: null,
                        status: 'offline',
                        user: globalUtils.miniUserObject(member.user)
                    });
                } else {
                    let session = sessions[sessions.length - 1]
    
                    if (!session.presence) {
                        presences.push({                             
                            game_id: null,
                            status: 'offline',
                            user: globalUtils.miniUserObject(member.user)
                        });
                    } else presences.push(session.presence);
                }
            }

            //#endregion

            //#region Guild Webhooks Logic
            const webhookRows = await database.runQuery(`
                SELECT * FROM webhooks WHERE guild_id = $1
            `, [id]);

            let webhooks = [];

            if (webhookRows !== null) {
                for (var row of webhookRows) {
                    let webhookAuthor = await database.getAccountByUserId(row.creator_id);

                    if (!webhookAuthor) continue;

                    webhooks.push({
                        guild_id: id,
                        channel_id: row.channel_id,
                        id: row.id,
                        token: row.token,
                        avatar: row.avatar == 'NULL' ? null : row.avatar,
                        name: row.name,
                        user: globalUtils.miniUserObject(webhookAuthor),
                        type: 1,
                        application_id: null
                    })
                }
            }

            //#endregion

            return {
                id: rows[0].id,
                name: rows[0].name,
                icon: rows[0].icon == 'NULL' ? null : rows[0].icon,
                splash: rows[0].splash == 'NULL' ? null : rows[0].splash,
                region: rows[0].region,
                owner_id: rows[0].owner_id,
                afk_channel_id: rows[0].afk_channel_id == 'NULL' ? null : rows[0].afk_channel_id,
                afk_timeout: rows[0].afk_timeout,
                channels: channels,
                exclusions: rows[0].exclusions ? JSON.parse(rows[0].exclusions) : [],
                members: members,
                roles: roles,
                emojis: emojis,
                webhooks: webhooks,
                presences: presences,
                voice_states: [],
                vanity_url_code: rows[0].vanity_url == 'NULL' ? null : rows[0].vanity_url,
                creation_date: rows[0].creation_date,
                features: rows[0].features ? JSON.parse(rows[0].features) : [],
                default_message_notifications: rows[0].default_message_notifications ?? 0,
                verification_level: rows[0].verification_level ?? 0
            }
        } catch (error) {
            logText(error, "error");

            return {
                id: rows[0].id,
                unavailable: true 
            }; //fallback ?
        }
    },
    transferGuildOwnership: async (guild_id, new_owner) => {
        try {
            await database.runQuery(`UPDATE guilds SET owner_id = $1 WHERE id = $2`, [new_owner, guild_id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    getUsersGuilds: async (id) => {
        try {
            const guilds = [];
            const members = await database.runQuery(`
                SELECT * FROM members WHERE user_id = $1
            `, [id]);

            if (members != null && members.length > 0) {
                for(var member of members) {
                    let guild = await database.getGuildById(member.guild_id);

                    if (guild != null) guilds.push(guild);
                }

                return guilds;
            } else {
                return [];
            }
        } catch(error) {
            logText(error, "error");

            return [];
        }
    },
    updateGuildWidget: async (guild_id, channel_id , enabled) => {
        try {
            if (channel_id == null) {
                channel_id = 'NULL'
            }

            await database.runQuery(`UPDATE widgets SET channel_id = $1, enabled = $2 WHERE guild_id = $3`, [channel_id, enabled == true ? 1 : 0, guild_id]);

            return true;    
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    getGuildWidget: async (guild_id) => {
        try {
            const rows = await database.runQuery(`SELECT * FROM widgets WHERE guild_id = $1`, [guild_id]);

            if (rows == null || rows.length == 0) {
                return null;
            }

            return {
                channel_id: rows[0].channel_id == 'NULL' ? null : rows[0].channel_id,
                enabled: rows[0].enabled == 1 ? true : false,
            }
        } catch(error) {
            logText(error, "error");

            return null;
        }
    },
    getChannelPermissionOverwrites: async (guild, channel_id) => {
        try {
            const channel = guild.channels.find(x => x.id === channel_id);

            if (channel == null || !channel.permission_overwrites) {
                return [];
            }

            if (channel.permission_overwrites.length == 0) {
                return [];
            }

            return channel.permission_overwrites;
        } catch(error) {
            logText(error, "error");

            return [];
        }
    },
    getInvite: async (code) => {
        try {
            const rows = await database.runQuery(`SELECT * FROM invites WHERE code = $1`, [code]);

            if (rows == null || rows.length == 0) {
                let isThereGuild = await database.getGuildByVanity(code);

                if (isThereGuild) {
                    return {
                        code: code,
                        temporary: false,
                        revoked: false,
                        inviter: null,
                        max_age: null,
                        max_uses: null,
                        uses: 0,
                        guild: {
                            id: isThereGuild.id,
                            name: isThereGuild.name,
                            icon: isThereGuild.icon,
                            splash: isThereGuild.splash,
                            owner_id: isThereGuild.owner_id
                        },
                        channel: {
                            id: isThereGuild.channels[0].id,
                            name: isThereGuild.channels[0].name,
                            guild_id: isThereGuild.channels[0].guild_id,
                            type: isThereGuild.channels[0].type
                        }
                    } 
                } else return null;
            }

            const guy = await database.getAccountByUserId(rows[0].inviter_id);

            if (guy == null) {
                return null;
            }

            const guild = await database.getGuildById(rows[0].guild_id);

            if (guild == null) {
                return null;
            }

            const channel = guild.channels.find(x => x.id === rows[0].channel_id);

            if (channel == null) {
                return null;
            }

            return {
                code: rows[0].code,
                temporary: rows[0].temporary == 1 ? true : false,
                revoked: rows[0].revoked == 1 ? true : false,
                inviter: globalUtils.miniUserObject(guy),
                max_age: rows[0].maxage,
                max_uses: rows[0].maxuses,
                uses: rows[0].uses,
                guild: {
                    id: guild.id,
                    name: guild.name,
                    icon: guild.icon,
                    splash: guild.splash,
                    owner_id: guild.owner_id
                },
                channel: {
                    id: channel.id,
                    name: channel.name,
                    guild_id: channel.guild_id,
                    type: channel.type
                }
            } 
        } catch(error) {
            logText(error, "error");

            return null;
        }
    },
    isBannedFromGuild: async (guild_id, user_id) => {
        try {
            const rows = await database.runQuery(`
                SELECT * FROM bans WHERE user_id = $1 AND guild_id = $2
            `, [user_id, guild_id]);

            if (rows == null || rows.length == 0) {
                return false;
            }

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    useInvite: async(code, user_id) => {
        try {
            const invite = await database.getInvite(code);

            if (invite == null) {
                return false;
            }

            const guild = await database.getGuildById(invite.guild.id); //hate this

            if (!guild) {
                return false;
            }

            const member = guild.members.find(x => x.id === user_id);

            if (member != null) {
                return true;
            }

            if (invite.max_uses && invite.max_uses != 0 && invite.uses >= invite.max_uses) {
                await database.deleteInvite(code);

                return false;
            }

            const isBanned = await database.isBannedFromGuild(invite.guild.id, user_id);

            if (isBanned) {
                return false;
            }

            const joinedGuild = await database.joinGuild(user_id, guild);

            if (!joinedGuild) {
                return false;
            }

            invite.uses++;

            await database.runQuery(`UPDATE invites SET uses = $1 WHERE code = $2`, [invite.uses, invite.code]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    clearRoles: async (guild, user_id) => {
        try {
            const member = guild.members.find(x => x.id === user_id);

            if (!member) {
                return false;
            }

            if (member.roles.length == 0) {
                return false;
            }

            await database.runQuery(`UPDATE members SET roles = $1 WHERE user_id = $2`, ['NULL', user_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    addRole: async (guild, role_id, user_id) => {
        try {
            const role = guild.roles.find(x => x.id === role_id);

            if (role == null) {
                return false;
            }

            if (role_id == guild_id) {
                return true; //everyone has the everyone role silly
            }

            const user = await database.getAccountByUserId(user_id);

            if (user == null) {
                return false;
            }

            const member = guild.members.find(x => x.id === user_id);

            if (member == null) {
                return false;
            }

            let roleStr = '';

            let stringRoles = member.roles;

            if (stringRoles.includes(role_id)) {
                return true;
            }

            if (member.roles.length > 1) {
                for(var role2 of member.roles) {
                    roleStr = roleStr + ':' + role2;
                }
            } else {
                roleStr = role_id;
            }

            if (roleStr.includes(":")) {
                roleStr = roleStr + ":" + role_id
            } else {
                roleStr = role_id;
            }

            roleStr = roleStr.replace(guild_id + ":", "")
            roleStr = roleStr.replace(guild_id, "")

            await database.runQuery(`UPDATE members SET roles = $1 WHERE user_id = $2`, [roleStr, user_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    setRoles: async (guild, role_ids, user_id) => {
        try {
            if (!user_id || !guild.id)
                return false;

            let guild_id = guild.id;
            
            let roleStr = null;

            for (var role of role_ids) {
                if (!guild.roles.find(x => x.id === role)) {
                    continue; //Invalid role
                }

                if (role == guild_id) {
                    continue; //everyone has the everyone role silly
                }
                
                if (roleStr == null)
                    roleStr = role;
                else
                    roleStr += ':' + role;
            }

            await database.runQuery(`UPDATE members SET roles = $1 WHERE user_id = $2`, [roleStr ?? "NULL", user_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    joinGuild: async (user_id, guild) => {
        try {
            const member = guild.members.find(x => x.id === user_id);

            if (member != null) {
                return false;
            }

            const roles = guild.roles;

            if (!roles || roles.length == 0) {
                return false;
            }

            const date = new Date().toISOString();

            await database.runQuery(`INSERT INTO members (guild_id, user_id, nick, roles, joined_at, deaf, mute) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [guild.id, user_id, 'NULL', guild.id, date, 0, 0]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    getChannelInvites: async (channel_id) => {
        try {
            const rows = await database.runQuery(`SELECT * FROM invites WHERE channel_id = $1`, [channel_id]);

            if (rows == null || rows.length == 0) {
                return [];
            }

            const ret = [];

            for(var row of rows) {
                const invite = await database.getInvite(row.code);

                if (invite != null) {
                    ret.push(invite);
                }
            }

            return ret;
        } catch(error) {
            logText(error, "error");
  
            return [];
        }
    },
    deleteInvite: async (code) => {
        try {
            const invite = await database.getInvite(code);

            if (invite == null) {
                return false;
            }

            await database.runQuery(`DELETE FROM invites WHERE code = $1`, [code]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    getGuildInvites: async (guild_id) => {
        try {
            const rows = await database.runQuery(`SELECT * FROM invites WHERE guild_id = $1`, [guild_id]);

            if (rows == null || rows.length == 0) {
                return [];
            }

            const ret = [];

            for(var row of rows) {
                const invite = await database.getInvite(row.code);

                if (invite != null) {
                    ret.push(invite);
                }
            }

            return ret;
        } catch(error) {
            logText(error, "error");

            return [];
        }
    },
    createInvite: async (guild_id, channel_id, inviter_id, temporary, maxUses, maxAge, xkcdpass, force_regenerate) => {
        try {
            let code = "";

            if (xkcdpass) {
                code = globalUtils.generateMemorableInviteCode();
            } else {
                code = globalUtils.generateString(16);
            }

            const date = new Date().toISOString();

            if (!force_regenerate) {
                const existingInvites = await database.runQuery(`SELECT * FROM invites WHERE guild_id = $1 AND channel_id = $2 AND revoked = $3 AND inviter_id = $4 AND maxuses = $5 AND xkcdpass = $6 AND maxage = $7`, [guild_id, channel_id, temporary == true ? 1 : 0, inviter_id, maxUses, xkcdpass == true ? 1 : 0, maxAge]);

                if (existingInvites != null && existingInvites != 'NULL' && existingInvites.length > 0) {
                    let code = existingInvites[0].code;
    
                    const invite = await database.getInvite(code);
    
                    if (invite == null) {
                        return null;
                    }
        
                    return invite;
                }
            }

            if (maxAge != 0) {
                setTimeout(async () => {
                    await database.deleteInvite(code);
                }, maxAge * 1000); //maxAge = seconds * 1000 = milliseconds
            }
            
            await database.runQuery(`INSERT INTO invites (guild_id, channel_id, code, temporary, revoked, inviter_id, uses, maxuses, maxage, xkcdpass, createdat) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [guild_id, channel_id, code, temporary == true ? 1 : 0, 0, inviter_id, 0, maxUses, maxAge, xkcdpass == true ? 1 : 0, date]);

            const invite = await database.getInvite(code);
    
            if (invite == null) {
                return null;
            }
    
            return invite;
        } catch(error) {
            logText(error, "error");

            return null;
        }
    },
    updateSettings: async (user_id, new_settings) => {
        try {
            await database.runQuery(`
                UPDATE users SET settings = $1 WHERE id = $2
            `, [JSON.stringify(new_settings), user_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    deleteRole: async (role_id) => {
        try {
            await database.runQuery(`DELETE FROM roles WHERE role_id = $1`, [role_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    createRole: async (guild_id, name, position) => {
        try {
            const role_id = Snowflake.generate();

            let default_permissions = 73468929; //READ, SEND, READ MSG HISTORY, CREATE INSTANT INVITE, SPEAK, MUTE_MEMBERS, CHANGE_NICKNAME

            await database.runQuery(`INSERT INTO roles (guild_id, role_id, name, permissions, position) VALUES ($1, $2, $3, $4, $5)`, [guild_id, role_id, name, default_permissions, position]);

            return {
                id: role_id,
                name: name,
                permissions: default_permissions,
                position: position,
                color: 0,
                hoist: false,
                mentionable: false
            };
        } catch(error) {
            logText(error, "error");

            return null;
        }
    },
    updateRole: async (role_id, name, color, hoist, mentionable, permissions, position) => {
        try {
            await database.runQuery(`UPDATE roles SET name = $1, permissions = $2, position = $3, color = $4, hoist = $5, mentionable = $6 WHERE role_id = $7`, [name, permissions, position, color, hoist ? 1 : 0, mentionable ? 1 : 0, role_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    deleteChannelPermissionOverwrite: async (guild, channel_id, overwrite) => {
        try {
            let current_overwrites = await database.getChannelPermissionOverwrites(guild, channel_id);

            let findOverwrite = current_overwrites.findIndex(x => x.id == overwrite.id);

            if (findOverwrite === -1) {
                return false;
            }

            current_overwrites.splice(findOverwrite, 1);

            let serialized = globalUtils.SerializeOverwritesToString(current_overwrites);

            await database.runQuery(`
                UPDATE channels SET permission_overwrites = $1 WHERE id = $2
            `, [serialized, channel_id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    updateChannelPermissionOverwrites: async (guild, channel_id, overwrites) => {
        try {
            let current_overwrites = await database.getChannelPermissionOverwrites(guild, channel_id);

            for(var i = 0; i < overwrites.length; i++) {
                let overwrite = overwrites[i];
                let old_overwrite = current_overwrites.findIndex(x => x.id == overwrite.id);

                if (old_overwrite === -1) {
                    current_overwrites.push(overwrite);
                } else {
                    current_overwrites[old_overwrite] = overwrite;
                }
            }

            let serialized = globalUtils.SerializeOverwritesToString(current_overwrites);

            await database.runQuery(`
                UPDATE channels SET permission_overwrites = $1 WHERE id = $2
            `, [serialized, channel_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    leaveGuild: async (user_id, guild_id) => {
        try {
            await database.runQuery(`DELETE FROM members WHERE guild_id = $1 AND user_id = $2`, [guild_id, user_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    //to-do: make the following below async and batch
    deleteChannel: async (channel_id) => {
        try {
            await database.runQuery(`DELETE FROM invites WHERE channel_id = $1`, [channel_id]);
            await database.runQuery(`DELETE FROM messages WHERE channel_id = $1`, [channel_id]);
            await database.runQuery(`DELETE FROM permissions WHERE channel_id = $1`, [channel_id]);
            await database.runQuery(`DELETE FROM channels WHERE id = $1`, [channel_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    deleteMessage: async (message_id) => {
        try {
            const message = await database.getMessageById(message_id);

            if (message == null) {
                return false;
            }

            await database.runQuery(`DELETE FROM messages WHERE message_id = $1`, [message_id]);
            
            const attachments = await database.runQuery(`SELECT * FROM attachments WHERE message_id = $1`, [message_id]);

            if (attachments != null && attachments.length > 0) {
                for(var attachment of attachments) {
                    fs.readdirSync(`./www_dynamic/attachments/${message.channel_id}/${attachment.attachment_id}`).forEach((file) => {
                        const curPath = path.join(`./www_dynamic/attachments/${message.channel_id}/${attachment.attachment_id}`, file);
                        
                        fs.unlinkSync(curPath);
                    });

                    fs.rmdirSync(`./www_dynamic/attachments/${message.channel_id}/${attachment.attachment_id}`);

                    await database.runQuery(`DELETE FROM attachments WHERE attachment_id = $1`, [attachment.attachment_id]);
                }
            }

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    //to-do: make the following below async and batch
    deleteGuild: async (guild_id) => {
        try {
            await database.runQuery(`DELETE FROM guilds WHERE id = $1`, [guild_id]);

            await database.runQuery(`DELETE FROM channels WHERE guild_id = $1`, [guild_id]);

            await database.runQuery(`DELETE FROM roles WHERE guild_id = $1`, [guild_id]);

            await database.runQuery(`DELETE FROM members WHERE guild_id = $1`, [guild_id]);

            await database.runQuery(`DELETE FROM widgets WHERE guild_id = $1`, [guild_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    createMessage: async (guild_id , channel_id, author_id, content, nonce, attachment, tts, mention_everyone, webhookProps = null, webhook_embeds = []) => {
        try {
            const id = Snowflake.generate();
            const date = new Date().toISOString();

            let author = null;

            if (author_id.startsWith("WEBHOOK_")) {
                let webhookId = author_id.split('_')[1];
                let webhook = await database.getWebhookById(webhookId);

                if (!webhook) {
                    return null;
                }

                //webhookProps.avatar_url - todo

                if (webhookProps == null) {
                    webhookProps = {
                        username: webhook.name
                    }
                }

                author = {
                    username: webhookProps.username,
                    discriminator: "0000",
                    id: webhookId,
                    bot: true,
                    webhook: true,
                    avatar: null
                }
            } else author = await database.getAccountByUserId(author_id);

            if (author == null) {
                return null;
            }

            if (content == undefined) {
                content = "";
            }

            let embeds = await embedder.generateMsgEmbeds(content);

            if (webhook_embeds) {
                embeds = webhook_embeds;   
            }

            await database.runQuery(`INSERT INTO messages (guild_id, message_id, channel_id, author_id, content, edited_timestamp, mention_everyone, nonce, timestamp, tts, embeds) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
                guild_id == null ? 'NULL' : guild_id,
                id,
                channel_id,
                author_id,
                content,
                'NULL',
                mention_everyone == true ? 1 : 0,
                nonce,
                date,
                (tts ? 1 : 0),
                JSON.stringify(embeds)
            ]);

            await database.runQuery(`UPDATE channels SET last_message_id = $1 WHERE id = $2`, [id, channel_id]);

            if (attachment != null) {
                await database.runQuery(`INSERT INTO attachments (attachment_id, message_id, filename, height, width, size, url) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
                    attachment.id,
                    id,
                    attachment.name,
                    attachment.height,
                    attachment.width,
                    attachment.size,
                    `${config.secure ? 'https' : 'http'}://${config.base_url}${globalUtils.nonStandardPort ? `:${config.port}` : ''}/attachments/${channel_id}/${attachment.id}/${attachment.name}`
                ]);
            }

            const message = await database.getMessageById(id);

            if (message == null) {
                return null;
            }

            return message;
        } catch(error) {
            logText(error, "error");

            return null;
        }
    },
    getGuildByVanity: async (vanity_url) => {
        try {
            if (vanity_url == null) {
                return null;
            }

            const rows = await database.runQuery(`
                SELECT * FROM guilds WHERE vanity_url = $1
            `, [vanity_url]);

            if (rows === null || rows.length === 0) {
                return null;
            }

            let id = rows[0].id;

            //#region Channels Logic
            const channelRows = await database.runQuery(`
                SELECT * FROM channels WHERE guild_id = $1
            `, [id]);

            if (channelRows === null || channelRows.length === 0) {
                return null;
            }

            let channels = [];

            for (var row of channelRows) {
                if (!row) continue;
    
                let overwrites = [];    
    
                if (row.permission_overwrites && row.permission_overwrites.includes(":")) {
                    for (var overwrite of row.permission_overwrites.split(':')) {
                        let role_id = overwrite.split('_')[0];
                        let allow_value = overwrite.split('_')[1];
                        let deny_value = overwrite.split('_')[2];
    
                        overwrites.push({
                            id: role_id,
                            allow: parseInt(allow_value),
                            deny: parseInt(deny_value),
                            type: overwrite.split('_')[3] ? overwrite.split('_')[3] : 'role'
                        });
                    }
                } else if (row.permission_overwrites && row.permission_overwrites != "NULL") {
                    let overwrite = row.permission_overwrites;
                    let role_id = overwrite.split('_')[0];
                    let allow_value = overwrite.split('_')[1];
                    let deny_value = overwrite.split('_')[2];
    
                    overwrites.push({
                        id: role_id,
                        allow: parseInt(allow_value),
                        deny: parseInt(deny_value),
                        type: overwrite.split('_')[3] ? overwrite.split('_')[3] : 'role'
                    });
                }
    
                channels.push({
                    id: row.id,
                    name: row.name,
                    guild_id: row.guild_id == 'NULL' ? null : row.guild_id,
                    type: parseInt(row.type),
                    topic: row.topic == 'NULL' ? null : row.topic,
                    nsfw: row.nsfw == 1 ?? false,
                    last_message_id: row.last_message_id,
                    permission_overwrites: overwrites,
                    position: row.position
                })
            }

            //#endregion

            //#region Roles Logic

            const roleRows = await database.runQuery(`
                SELECT * FROM roles WHERE guild_id = $1
            `, [id]);

            if (roleRows === null || roleRows.length === 0) {
                return null;
            }

            let roles = [];

            for(var row of roleRows) {
                roles.push({
                    id: row.role_id,
                    name: row.name,
                    permissions: row.permissions,
                    position: row.position,
                    color: row.color,
                    hoist: row.hoist == 1,
                    mentionable: row.mentionable == 1
                });
            }

            //#endregion

            //#region Guild Members Logic

            const memberRows = await database.runQuery(`
                SELECT * FROM members WHERE guild_id = $1
            `, [id]);

            if (memberRows === null || memberRows.length === 0) {
                return null;
            }

            let members = [];

            for (var row of memberRows) {
                const member_roles = [];

                if (row.roles.includes(':')) {
                    const db_roles = row.roles.split(':');

                    for (var db_role of db_roles) {
                        if (roles.find(x => x.id === db_role)) {
                            member_roles.push(db_role);
                        }
                    }
                } else {
                    if (roles.find(x => x.id === row.roles)) {
                        member_roles.push(row.roles);
                    }
                }

                const user = await database.getAccountByUserId(row.user_id);

                if (user == null) {
                    continue;
                }

                members.push({
                    id: user.id,
                    nick: row.nick == 'NULL' ? null : row.nick,
                    deaf: ((row.deaf == 'TRUE' || row.deaf == 1) ? true : false),
                    mute: ((row.mute == 'TRUE' || row.mute == 1) ? true : false),
                    roles: member_roles,
                    user: globalUtils.miniUserObject(user)
                })
            }

            //#endregion

            //#region Custom Emojis Logic

            let emojis = JSON.parse(rows[0].custom_emojis); //???

            for (var emoji of emojis) {
                emoji.roles = [];
                emoji.require_colons = true;
                emoji.managed = false;
                emoji.allNamesString = `:${emoji.name}:`
            }

            //#endregion

            //#region Guild Presences Logic

            let presences = [];

            for(var member of members) {
                let sessions = global.userSessions.get(member.id);

                if (global.userSessions.size === 0 || !sessions) {
                    presences.push({                             
                        game_id: null,
                        status: 'offline',
                        user: globalUtils.miniUserObject(member.user)
                    });
                } else {
                    let session = sessions[sessions.length - 1]
    
                    if (!session.presence) {
                        presences.push({                             
                            game_id: null,
                            status: 'offline',
                            user: globalUtils.miniUserObject(member.user)
                        });
                    } else presences.push(session.presence);
                }
            }

            //#endregion

            //#region Guild Webhooks Logic
            const webhookRows = await database.runQuery(`
                SELECT * FROM webhooks WHERE guild_id = $1
            `, [id]);

            let webhooks = [];

            if (webhookRows !== null) {
                for (var row of webhookRows) {
                    let webhookAuthor = await database.getAccountByUserId(row.creator_id);

                    if (!webhookAuthor) continue;

                    webhooks.push({
                        guild_id: id,
                        channel_id: row.channel_id,
                        id: row.id,
                        token: row.token,
                        avatar: row.avatar == 'NULL' ? null : row.avatar,
                        name: row.name,
                        user: globalUtils.miniUserObject(webhookAuthor),
                        type: 1,
                        application_id: null
                    })
                }
            }

            //#endregion

            return {
                id: rows[0].id,
                name: rows[0].name,
                icon: rows[0].icon == 'NULL' ? null : rows[0].icon,
                splash: rows[0].splash == 'NULL' ? null : rows[0].splash,
                region: rows[0].region,
                owner_id: rows[0].owner_id,
                afk_channel_id: rows[0].afk_channel_id == 'NULL' ? null : rows[0].afk_channel_id,
                afk_timeout: rows[0].afk_timeout,
                channels: channels,
                exclusions: rows[0].exclusions ? JSON.parse(rows[0].exclusions) : [],
                members: members,
                roles: roles,
                emojis: emojis,
                webhooks: webhooks,
                presences: presences,
                voice_states: [],
                vanity_url_code: rows[0].vanity_url == 'NULL' ? null : rows[0].vanity_url,
                creation_date: rows[0].creation_date,
                features: rows[0].features ? JSON.parse(rows[0].features) : [],
                default_message_notifications: rows[0].default_message_notifications ?? 0,
                verification_level: rows[0].verification_level ?? 0
            }
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    updateGuildVanity: async (guild_id, vanity_url) => {
        try {
            let send_vanity = 'NULL';
            
            if (vanity_url != null) {
                send_vanity = vanity_url;
            }

            let checkGuild = await database.getGuildByVanity(send_vanity);

            if (checkGuild != null && vanity_url != null) {
                return 0; //taken
            }

            await database.runQuery(`UPDATE guilds SET vanity_url = $1 WHERE id = $2`, [vanity_url, guild_id]);

            return 1; //success
        } catch(error) {
            logText(error, "error");

            return -1; //error
        }
    },
    updateGuild: async (guild_id, afk_channel_id, afk_timeout, icon, splash, name, default_message_notifications, verification_level) => {
        try {
            let send_icon  = 'NULL';
            let send_splash = 'NULL';

            if (icon != null) {
                if (icon.includes("data:image")) {
                    var extension = icon.split('/')[1].split(';')[0];
                    var imgData =  icon.replace(`data:image/${extension};base64,`, "");
                    var file_name = Math.random().toString(36).substring(2, 15) + Math.random().toString(23).substring(2, 5);
                    var hash = md5(file_name);
            
                    if (extension == "jpeg") {
                        extension = "jpg";
                    }
            
                    send_icon = hash.toString();
            
                    if (!fs.existsSync(`www_dynamic/icons`)) {
                        fs.mkdirSync(`www_dynamic/icons`, { recursive: true });
                    }
    
                    if (!fs.existsSync(`www_dynamic/icons/${guild_id}`)) {
                        fs.mkdirSync(`www_dynamic/icons/${guild_id}`, { recursive: true });
            
                        fs.writeFileSync(`www_dynamic/icons/${guild_id}/${hash}.${extension}`, imgData, "base64");
                    } else {
                        fs.writeFileSync(`www_dynamic/icons/${guild_id}/${hash}.${extension}`, imgData, "base64");
                    }
                } else {
                    send_icon = icon;
                }
            }

            if (splash != null) {
                if (splash.includes("data:image")) {
                    var extension = splash.split('/')[1].split(';')[0];
                    var imgData = splash.replace(`data:image/${extension};base64,`, "");
                    var file_name = Math.random().toString(36).substring(2, 15) + Math.random().toString(23).substring(2, 5);
                    var hash = md5(file_name);
            
                    if (extension == "jpeg") {
                        extension = "jpg";
                    }
            
                    send_splash = hash.toString();
            
                    if (!fs.existsSync(`www_dynamic/splashes`)) {
                        fs.mkdirSync(`www_dynamic/splashes`, { recursive: true });
                    }
    
                    if (!fs.existsSync(`www_dynamic/splashes/${guild_id}`)) {
                        fs.mkdirSync(`www_dynamic/splashes/${guild_id}`, { recursive: true });
            
                        fs.writeFileSync(`www_dynamic/splashes/${guild_id}/${hash}.${extension}`, imgData, "base64");
                    } else {
                        fs.writeFileSync(`www_dynamic/splashes/${guild_id}/${hash}.${extension}`, imgData, "base64");
                    }
                } else {
                    send_splash = splash;
                }
            }

            await database.runQuery(`UPDATE guilds SET name = $1, icon = $2, splash = $3, afk_channel_id = $4, afk_timeout = $5, default_message_notifications = $6, verification_level = $7 WHERE id = $8`, [name, send_icon, send_splash, (afk_channel_id == null ? 'NULL' : afk_channel_id), afk_timeout, default_message_notifications, verification_level, guild_id]);

            return true;
        } catch(error) {
            logText(error, "error");

            return false;
        }
    },
    createGuild: async (owner_id, icon , name, region, exclusions) => {
        try {
            const id = Snowflake.generate();
            const date = new Date().toISOString();
            const owner = await database.getAccountByUserId(owner_id);

            if (owner == null) {
                return null;
            }

            if (icon != null) {
                var extension = icon.split('/')[1].split(';')[0];
                var imgData =  icon.replace(`data:image/${extension};base64,`, "");
                var file_name = Math.random().toString(36).substring(2, 15) + Math.random().toString(23).substring(2, 5);
                var hash = md5(file_name);
        
                if (extension == "jpeg") {
                    extension = "jpg";
                }
        
                icon = hash.toString();
        
                if (!fs.existsSync(`www_dynamic/icons`)) {
                    fs.mkdirSync(`www_dynamic/icons`, { recursive: true });
                }

                if (!fs.existsSync(`www_dynamic/icons/${id}`)) {
                    fs.mkdirSync(`www_dynamic/icons/${id}`, { recursive: true });
        
                    fs.writeFileSync(`www_dynamic/icons/${id}/${hash}.${extension}`, imgData, "base64");
                } else {
                    fs.writeFileSync(`www_dynamic/icons/${id}/${hash}.${extension}`, imgData, "base64");
                }
            }

            await database.runQuery(`INSERT INTO guilds (id, name, icon, region, owner_id, afk_channel_id, afk_timeout, creation_date, exclusions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [id, name, (icon == null ? 'NULL' : icon), region, owner_id, 'NULL', 300, date, JSON.stringify(exclusions)])
            await database.runQuery(`INSERT INTO channels (id, type, guild_id, topic, last_message_id, permission_overwrites, name, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, 0, id, 'NULL', '0', 'NULL', 'general', 0]);
            await database.runQuery(`INSERT INTO roles (guild_id, role_id, name, permissions, position) VALUES ($1, $2, $3, $4, $5)`, [id, id, '@everyone', 104193089, 0]); 
            await database.runQuery(`INSERT INTO members (guild_id, user_id, nick, roles, joined_at, deaf, mute) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, owner_id, 'NULL', id, date, 0, 0]);
            await database.runQuery(`INSERT INTO widgets (guild_id, channel_id, enabled) VALUES ($1, $2, $3)`, [id, 'NULL', 0]);

            return {
                afk_channel_id: null,
                afk_timeout: 300,
                channels: [{
                    type: 0,
                    topic: null,
                    nsfw: false,
                    position: 0,
                    permission_overwrites: [],
                    name: 'general',
                    last_message_id: '0',
                    id: id,
                    guild_id: id
                }],
                members: [{
                    deaf: false,
                    mute: false,
                    nick: null,
                    id: owner_id,
                    joined_at: date,
                    roles: [],
                    user: globalUtils.miniUserObject(owner)
                }],
                presences: [{
                    game_id: null,
                    status: "online",
                    user: globalUtils.miniUserObject(owner),
                }],
                icon: icon,
                splash: null,
                id: id,
                name: name,
                owner_id: owner_id,
                region: region,
                voice_states: [],
                roles: [{
                    id: id,
                    name: "@everyone", 
                    permissions: 104193089,
                    position: 0
                }]
            }
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    createAccount: async (username, email, password) => {
        try {
            let user = await database.getAccountByEmail(email);

            if (user != null) {
                return {
                    success: false,
                    reason: "Email is already registered."
                }
            }

            let users = await database.getAccountsByUsername(username);

            if (users.length == 9999) {
                return {
                    success: false,
                    reason: "Too many people have this username."
                }
            }

            let salt = await genSalt(10);
            let pwHash = await hash(password, salt);
            let id = Snowflake.generate();
            let date = new Date().toISOString();
            let discriminator = Math.round(Math.random() * 9999);

            while (discriminator < 1000) {
                discriminator = Math.round(Math.random() * 9999);
            }

            let token = globalUtils.generateToken(id, pwHash);

            await database.runQuery(`INSERT INTO users (id,username,discriminator,email,password,token,created_at,avatar) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, username, discriminator.toString(), email, pwHash, token, date, 'NULL'])

            return {
                token: token
            }
        } catch (error) {
            logText(error, "error");

            return {
                success: false,
                reason: "Something went wrong while creating account."
            }
        }
    },
    doesThisMatchPassword: async (password_raw, password_hash) => {
        try {
            let comparison = compareSync(password_raw, password_hash);

            if (!comparison) {
                return false;
            }

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    setPinState: async (message_id, state) => {
        try {
            await database.runQuery(`UPDATE messages SET pinned = $1 WHERE message_id = $2`, [state ? 1 : 0, message_id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    updateMessage: async (message_id, new_content) => {
        try {
            let embeds = await embedder.generateMsgEmbeds(new_content);

            let date = new Date().toISOString();

            await database.runQuery(`UPDATE messages SET content = $1, edited_timestamp = $2, embeds = $3 WHERE message_id = $4`, [new_content, date, embeds.length > 0 ? JSON.stringify(embeds) : 'NULL', message_id]);

            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    updateAccount: async (avatar , email , username , discriminator, password , new_password , new_email ) => {
        try {
            if (email == null) {
                return false;
            }

            if (username == null) {
                return false;
            }

            const account = await database.getAccountByEmail(email);

            if (account == null || !account.password || !account.email) {
                return false;
            }

            let new_avatar = avatar;
            let new_email2 = email;
            let new_username = username;
            let new_discriminator = account.discriminator;

            if (discriminator && parseInt(discriminator) >= 1000 && parseInt(discriminator) < 10000 && discriminator != account.discriminator) {
                let existingUsers = await global.database.getAccountByUsernameTag(new_username, discriminator);

                if (existingUsers === null) {
                    new_discriminator = discriminator;
                } else {
                    return false;  // Discriminator is already taken
                }
            }

            

            if (new_email != null) {
                new_email2 = new_email;
            }

            if (avatar != null && avatar.includes("data:image/")) {
                var extension = avatar.split('/')[1].split(';')[0];
                var imgData = avatar.replace(`data:image/${extension};base64,`, "");
                var name = Math.random().toString(36).substring(2, 15) + Math.random().toString(23).substring(2, 5);
                var name_hash = md5(name);
    
                if (extension == "jpeg") {
                    extension = "jpg";
                }
    
                new_avatar = name_hash.toString();
    
                if (!fs.existsSync(`./www_dynamic/avatars/${account.id}`)) {
                    fs.mkdirSync(`./www_dynamic/avatars/${account.id}`, { recursive: true });
                }
 
                fs.writeFileSync(`./www_dynamic/avatars/${account.id}/${name_hash}.${extension}`, imgData, "base64");

                await database.runQuery(`UPDATE users SET avatar = $1 WHERE id = $2`, [new_avatar, account.id]);
            } else if (avatar == null) {
                await database.runQuery(`UPDATE users SET avatar = $1 WHERE id = $2`, ['NULL', account.id]);
            }

            let accounts = await database.getAccountsByUsername(new_username);

            if (accounts.length >= 9998 && account.username != new_username) {
                return false;
            }

            if (accounts.find(x => x.discriminator == new_discriminator && x.username == new_username)) {
                new_discriminator = Math.round(Math.random() * 9999);

                while (new_discriminator < 1000) {
                    new_discriminator = Math.round(Math.random() * 9999);
                }
            }

            if (new_password != null) {
                const checkPassword = await database.doesThisMatchPassword(new_password, account.password);

                if (checkPassword) {
                    return false;
                }

                let salt = await genSalt(10);
                let newPwHash = await hash(new_password, salt);
                let token = globalUtils.generateToken(account.id, newPwHash);

                await database.runQuery(`UPDATE users SET username = $1, discriminator = $2, email = $3, password = $4, token = $5 WHERE id = $6`, [new_username, new_discriminator, new_email2, newPwHash, token, account.id]);

                return true;
            }

            if ((new_email2 != account.email && new_username != account.username) || (new_email2 != account.email || new_username != account.username)) {
                if (password == null) {
                    return false;
                }

                const checkPassword = await database.doesThisMatchPassword(password, account.password);

                if (!checkPassword) {
                    return false;
                }

                await database.runQuery(`UPDATE users SET username = $1, discriminator = $2, email = $3 WHERE id = $4`, [new_username, new_discriminator, new_email2, account.id]);
            }
            
            return true;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    },
    checkAccount: async (email, password) => {
        try {
            let user = await database.getAccountByEmail(email);

            // IHATE TYPESCRIPT I HATE TYPESCRIPT I HATE TYPESCRIPT
            if (user == null || !user?.email || !user?.password || !user?.token || !user?.settings) {
                return {
                    success: false,
                    reason: "Email and/or password is invalid."
                }
            }

            if (user.disabled_until != null) {
                return {
                    success: false,
                    disabled_until: user.disabled_until
                }
            }
            
            let comparison = compareSync(password, user.password);

            if (!comparison) {
                return {
                    success: false,
                    reason: "Email and/or password is invalid."
                }
            }

            return {
                token: user.token
            }
        } catch (error) {
            logText(error, "error");

            return {
                success: false,
                reason: "Something went wrong while checking account."
            }
        }
    },
};

module.exports = database;
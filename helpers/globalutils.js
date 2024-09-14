const crypto = require('crypto');
const encode = require('base64url');
const fs = require('fs');
const { logText } = require('./logger');
const { default: fetch } = require('node-fetch');

const configPath = "./config.json";

if (!fs.existsSync(configPath)) {
    console.error("No config.json file exists: Please create one using config.example.json as a template.");
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const globalUtils = {
    config: config,
    nonStandardPort: config.secure ? config.port != 443 : config.port != 80,
    nonStandardWsPort: config.secure ? config.ws_port != 443 : config.ws_port != 80,
    generateGatewayURL: (req) => {
        let host = req.headers['host'];
        if (host) host = host.split(':', 2)[0];
        return `${config.secure ? 'wss' : 'ws'}://${config.gateway_url == "" ? (host ?? config.base_url) : config.gateway_url}:${config.ws_port}`;
    },
    unavailableGuildsStore: [],
    generateString: (length) => {
        let result = '';
        let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let charactersLength = characters.length;
    
        for (var i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
    
        return result;
    },
    generateMemorableInviteCode: () => {
        let code = "";

        var words = [
            "karthus",
            "terrorblade",
            "remora",
            "archon",
            "phantom",
            "charmander",
            "azmodan",
            "landslide",
            "anivia",
            "biggs",
            "rosalina",
            "overlord",
            "sephiroth",
            "cloud",
            "tifa",
            "illidan",
            "jaina",
            "arthas",
            "sylvanas",
            "thrall",
            "invoker",
            "pudge",
            "crystal",
            "anti",
            "jinx",
            "lux",
            "zed",
            "yasuo",
            "ahri"
        ];

        for(var i = 0; i < 3; i++) {
            code += words[Math.floor(Math.random() * words.length)] + '-'
        };

        code = code.substring(code.lastIndexOf('-'), -1);

        return code;
    },
    addClientCapabilities: (client_build, obj) => {
        let parts = client_build ? client_build.split('_') : null;
        if (!parts || parts.length < 3) {
            //Invalid release date format. Use defaults.
            obj.client_build = "";
            obj.client_build_date = new Date();
            obj.channel_types_are_ints = false;
            return false;
        } else {
            let month = parts[0];
            let day = parts[1];
            let year = parts[2];
            let date = new Date(`${month} ${day} ${year}`);
            
            obj.client_build = client_build;
            obj.client_build_date = date;
            obj.plural_recipients = (date.getFullYear() == 2016 && date.getMonth() >= 6) || date.getFullYear() >= 2017;
            obj.channel_types_are_ints = obj.plural_recipients;
            return true;
        }
    },
    flagToReason: (flag) => {
        let ret = "";

        switch(flag) {
            case "NO_REGISTRATION":
                ret = "Account registration is currently disabled on this instance."
                break;
            case "NO_GUILD_CREATION":
                ret = "Creating guilds is currently not allowed on this instance."
                break;
            case "NO_INVITE_USE":
                ret = "You are not allowed to accept this invite."
                break;
            case "NO_INVITE_CREATION":
                ret = "Creating invites is not allowed on this instance."
                break;
        }

        return ret;
    },
    getRegions: () => {
        return [{
            id: "2016",
            name: "2015-2016"
        }, {
            id: "2017",
            name: "2015-2017"
        }, {
            id: "2018",
            name: "2015-2018"
        }, {
            id: "everything",
            name: "Everything"
        }];
    },
    serverRegionToYear: (region) => {
        return globalUtils.getRegions().find(x => x.id.toLowerCase() == region) ? globalUtils.getRegions().find(x => x.id.toLowerCase() == region).name : "everything"
    },
    canUseServer: (year, region) => {
        let serverRegion = globalUtils.serverRegionToYear(region);

        if (serverRegion.toLowerCase() === "everything") {
            return true;
        }

        let firstYear = serverRegion.split('-')[0];
        let lastYear = serverRegion.split('-')[1];

        if (year > parseInt(lastYear) || year < parseInt(firstYear)) {
            return false;
        }

        return true;
    },
    generateToken: (user_id, password_hash) => {
        //sorry ziad but im stealing this from hummus source, love you
        //oh also this: https://user-images.githubusercontent.com/34555296/120932740-4ca47480-c6f7-11eb-9270-6fb3fbbd856c.png

        const key = `${config.token_secret}--${password_hash}`;
        const timeStampBuffer = Buffer.allocUnsafe(4);
        
        timeStampBuffer.writeUInt32BE(((Math.floor(Date.now() / 1000)) - 1293840));

        const encodedTimeStamp = encode(timeStampBuffer);
        const encodedUserId = encode(user_id);
        const partOne = `${encodedUserId}.${encodedTimeStamp}`;
        const encryptedAuth = crypto.createHmac('sha3-224', key).update(partOne).digest();
        const encodedEncryptedAuth = encode(encryptedAuth);
        const partTwo = `${partOne}.${encodedEncryptedAuth}`;

        return partTwo;
    },
    replaceAll: (str, find, replace) => {
        if (typeof find === 'string') {
            find = find.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'); // Escape special characters
            find = new RegExp(find, 'g');
        } else if (!(find instanceof RegExp)) {
            throw new TypeError('find must be a string or a RegExp');
        }
    
        return str.replace(find, replace);
    },
    SerializeOverwriteToString(overwrite) {
        return `${overwrite.id}_${overwrite.allow.toString()}_${overwrite.deny.toString()}_${overwrite.type}`;
    },
    SerializeOverwritesToString(overwrites) {
        if (overwrites == null || overwrites.length == 0) {
            return null;
        }

        let ret = "";

        for(var overwrite of overwrites) {
            ret += `${globalUtils.SerializeOverwriteToString(overwrite)}:`;
        }

        ret = ret.slice(0, -1);

        return ret;
    },
    sanitizeObject: (object, toSanitize = []) => {
        const sanitizedObject = { ...object };

        if (toSanitize.length > 0) {
            toSanitize.forEach(property => {
                delete sanitizedObject[property];
            });
        }

        return sanitizedObject;
    },
    buildGuildObject: (guild, req) => {
        if (!guild) return null;

        if (!req.account) return null;

        if (guild.region != "everything" && client_build.getFullYear() != parseInt(guild.region)) {
            let sessions = global.userSessions.get(req.account.id);

            if (!sessions) return guild; //fallback ig

            let session = sessions.find(x => x.socket != null && x.socket.client_build === req.client_build);
                
            if (!session) return guild;
            
            let proper_guild = session.guilds.find(x => x.id === guild.id);

            if (!session.guilds || !proper_guild) return guild; //man wtf

            return proper_guild;
        }

        return guild;
    },
    unavailableGuild: async (guild, error) => {
        //danger zone buddy

        if (globalUtils.unavailableGuildsStore.includes(guild.id)) {
            return false;
        }

        await global.dispatcher.dispatchEventInGuild(guild, "GUILD_DELETE", {
            id: guild.id,
            unavailable: true
        });

        globalUtils.unavailableGuildsStore.push(guild.id);

        logText(`[GUILD UNAVAILABLE] ${guild.id} (${guild.name}) -> ${error.toString()}`, "debug");

        setTimeout(async () => {
            await globalUtils.availableGuild(guild); //should we do this? we gotta bring it back to the user who fucked shit up eventually
        }, 1000 * (Math.round(Math.random() * 300)));

        return true;
    },
    availableGuild: async (guild) => {
        //holy shit bucko

        if (!globalUtils.unavailableGuildsStore.includes(guild.id)) {
            return false;
        }

        await global.dispatcher.dispatchEventInGuild(guild, "GUILD_CREATE", guild);

        globalUtils.unavailableGuildsStore = globalUtils.unavailableGuildsStore.filter(x => x !== guild.id);

        logText(`[GUILD AVAILABLE] ${guild.id} (${guild.name})`, "debug");

        return true;
    },
    checkUsername: (username) => {
        let allowed = /^[A-Za-z0-9А-Яа-яЁё\s.]+$/;

        if (!username) {
            return {
                code: 400,
                username: "This field is required."
            }
        }

        if (username.length > 32) {
            return {
                code: 400,
                username: "Maximum character length for usernames reached (32).",
            };
        }

        if (username.length < 2) {
            return {
                code: 400,
                username: "Minimum character length for usernames not reached (2).",
            };
        }

        if (username.startsWith(" ")) {
            return {
                code: 400,
                username: "Username cannot start with a space.",
            };
        }

        if (username.endsWith(" ")) {
            return {
                code: 400,
                username: "Username cannot end with a space.",
            };
        }

        if (!allowed.test(username)) {
            return {
                code: 400,
                username: "That username is not allowed. Please try another.",
            };
        }

        return {
            code: 200,
            username: ""
        }
    },
    badEmail: async (email) => {
        /*
        try {
            let domain = email.split('@')[1];

            let response = await fetch("https://raw.githubusercontent.com/unkn0w/disposable-email-domain-list/main/domains.txt");

            if (response.ok && !(await response.text()).includes(domain.toLowerCase())) {
                return false;
            }

            return true;
        } catch {
            return true;
        }
        */
       return false; //to-do
    },
    prepareAccountObject: (rows, relationships) => {
        if (rows === null || rows.length === 0) {
            return null;
        }

        const user = {
            id: rows[0].id,
            username: rows[0].username,
            discriminator: rows[0].discriminator,
            avatar: rows[0].avatar == 'NULL' ? null : rows[0].avatar,
            email: rows[0].email,
            password: rows[0].password,
            token: rows[0].token,
            verified: rows[0].verified == 1 ? true : false,
            premium: true,
            flags: rows[0].flags ?? 0,
            bot: rows[0].bot == 1 ? true : false,
            created_at: rows[0].created_at,
            relationships: relationships ?? [],
            settings: JSON.parse(rows[0].settings),
            claimed: true
        };

        if (rows[0].disabled_until != 'NULL') {
            user.disabled_until = rows[0].disabled_until;
        }

        if (rows[0].disabled_reason != 'NULL') {
            user.disabled_reason = rows[0].disabled_reason;
        }

        return user;
    },
    areWeFriends: (user1, user2) => {
        let ourRelationships = user1.relationships;
        let theirRelationships = user2.relationships;
        let relationshipState = theirRelationships.find(x => x.id === user1.id);
        let ourRelationshipState = ourRelationships.find(x => x.id === user2.id);

        if (!ourRelationshipState) {
            ourRelationships.push({
                id: user2.id,
                type: 0,
                user: globalUtils.miniUserObject(user2)
            });

            ourRelationshipState = ourRelationships.find(x => x.user.id == user2.id);
        }

        if (!relationshipState) {
            theirRelationships.push({
                id: user1.id,
                type: 0,
                user: globalUtils.miniUserObject(user1)
            })

            relationshipState = theirRelationships.find(x => x.id === user1.id);
        }

        return relationshipState.type === 1 && ourRelationshipState.type === 1;
    },
    parseMentions: (text) => {
        let result = {
            mentions: [],
            mention_roles: [],
            mention_everyone: false,
            mention_here: false,
        };

        if (!text)
            return result;

        let i = 0;
        while (i < text.length) {
            switch (text[i++]) {
                case '\\':
                    //Escape: Skip next char
                    i++;
                    break;

                case '@':
                    if (text.startsWith("everyone", i)) {
                        //Mention @everyone
                        result.mention_everyone = true;
                        i += "everyone".length;
                        break;
                    }
                    if (text.startsWith("here", i)) {
                        //Mention @here
                        result.mention_here = true;
                        i += "here".length;
                        break;
                    }
                    break;

                case '<':
                    if (text[i++] != '@')
                        break; //Ignore non-user mentions

                    //Check type (optional)
                    let targetArray = result.mentions;
                    switch (text[i]) {
                        case '!': //Nickname
                            i++;
                            break;

                        case '&': //Role
                            targetArray = result.mention_roles;
                            i++;
                            break;
                    }

                    //Read snowflake
                    let snowflake = "";
                    while (true) {
                        if (i >= text.length) {
                            //Snowflake not complete
                            snowflake = "";
                            break;
                        }

                        const c = text[i];
                        if (c == '>') {
                            //Completed valid snowflake
                            break;
                        }

                        if (c >= '0' && c <= '9') {
                            snowflake += c;
                            i++;
                        } else {
                            //Invalid snowflake
                            snowflake = "";
                            break;
                        }
                    }

                    if (snowflake && snowflake.length > 0)
                        targetArray.push(snowflake);

                    break;
                    
                case '`':
                    let startTicks = 1;
                    let startIndex = i;
                    if (text[i++] == '`') {
                        startTicks++;
                        if (text[i++] == '`') {
                            startTicks++;
                        }
                    }
                    
                    let success = false;
                    while (i < text.length) {
                        if (text[i++] == '`') {
                            let endTicks = 1;
                            while (endTicks < startTicks) {
                                if (text[i++] != '`')
                                    break;
                                endTicks++;
                            }
                            
                            if (endTicks >= startTicks && text[i] != '`') {
                                success = true;
                                break;
                            }
                        }
                    }
                    if (!success)
                        i = startIndex;
                    break;
            }
        }

        return result;
    },
    pingPrivateChannel: async (channel) => {
        for(var recipient of channel.recipients) {
            await globalUtils.pingPrivateChannelUser(channel, recipient.id);
        }
    },
    pingPrivateChannelUser: async (private_channel, recipient_id) => {
        let userPrivChannels = await database.getPrivateChannels(recipient_id);
        
        let sendCreate = false;
        if (!userPrivChannels) {
            //New
            userPrivChannels = [private_channel.id];
            sendCreate = true;
        } else {
            if (userPrivChannels.includes(private_channel.id)) {
                //Remove old entry
                const oldIndex = userPrivChannels.indexOf(private_channel.id);
                userPrivChannels.splice(oldIndex, 1);
            } else {
                sendCreate = true;
            }

            //Add to top
            userPrivChannels.unshift(private_channel.id);
        }

        await database.setPrivateChannels(recipient_id, userPrivChannels);
        
        if (sendCreate) {
            await global.dispatcher.dispatchEventTo(recipient_id, "CHANNEL_CREATE", function() {
                return globalUtils.personalizeChannelObject(this.socket, private_channel);
            });
        }
    },
    channelTypeToString: (type) => {
        switch (type) {
            case 0: return "text";
            case 1: return "dm";
            case 2: return "voice";
            case 3: return "group_dm";
            case 4: return "category";
            default: return "text";
        }
    },
    personalizeChannelObject: (req, channel) => {
        if (!req)
            return channel;
        
        if (!req.plural_recipients && channel.type >= 2)
            return null;
        
        let clone = {}
        Object.assign(clone, channel);
        
        if (channel.recipients)
            clone.recipients = channel.recipients.filter(r => r.id != req.user.id);
        
        if (!req.plural_recipients) {
            clone.is_private = channel.type > 0;
            clone.recipient = clone.recipients[0];
            delete clone.recipients;
        }
        
        if (!req.channel_types_are_ints)
            clone.type = globalUtils.channelTypeToString(parseInt(channel.type));
        
        return clone;
    },
    personalizePresenceObject: (req, presence, guild) => {
        if (req.client_build_date.getFullYear() < 2018)
            return presence;
        
        //late 2018 requires roles in presences to not crash. horseshit design
        let newPresence = {};
        
        Object.assign(newPresence, presence);
        
        if (guild) {
            let member = guild.members.find(x => x.id === this.user.id);
            newPresence.roles = member ? [] : member.roles;
        } else { 
            newPresence.roles = [];
        }
        
        return newPresence;
    },
    usersToIDs: (array) => {
        let IDs = [];
        
        for (let i = 0; i < array.length; i++)
            if (array[i].id)
                IDs.push(array[i].id);
            else if ((typeof array[i]) == "string")
                IDs.push(array[i]);
            
        return IDs;
    },
    miniUserObject: (user) => {
        return {
            username: user.username,
            discriminator: user.discriminator,
            id: user.id,
            avatar: user.avatar,
            bot: user.bot,
            flags: user.flags,
            premium: user.premium
        };
    },
    miniBotObject: (bot) => {
        delete bot.token;

        return bot;
    }
};

module.exports = globalUtils;
const crypto = require('crypto');
const encode = require('base64url');
const fs = require('fs');
const { logText } = require('./logger');

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
    requiresIntsForChannelTypes: (build) => {
        try {
            let parts = build.split('_');
            let month = parts[0];
            let day = parts[1];
            let year = parts[2];
            let date = new Date(`${month} ${day} ${year}`);

            return parts[2] == "2015" ? false : ((parts[2] == "2016" && date.getMonth() >= 6) || date.getFullYear() >= 2017);
        }
        catch(error) {
            logText(error, "error");

            return true;
        }
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
            obj.channel_types_are_ints = this.requiresIntsForChannelTypes(client_build);
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
            name: "Up to 2016"
        }, {
            id: "2017",
            name: "Up to 2017"
        }, {
            id: "2018",
            name: "Up to 2018"
        }, {
            id: "2019",
            name: "Up to 2019"
        }, {
            id: "everything",
            name: "Everything"
        }];
    },
    serverRegionToYear: (region) => {
        return globalUtils.getRegions().find(x => x.id.toLowerCase() == region) ? globalUtils.getRegions().find(x => x.id.toLowerCase() == region).name : "everything"
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
    prepareAccountObject: (rows) => {
        if (rows == null || rows.length == 0) {
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
            verified: true,
            bot: rows[0].bot == 1 ? true : false,
            created_at: rows[0].created_at,
            settings: JSON.parse(rows[0].settings)
        };

        if (rows[0].disabled_until != 'NULL') {
            user.disabled_until = rows[0].disabled_until;
        }

        if (rows[0].disabled_reason != 'NULL') {
            user.disabled_reason = rows[0].disabled_reason;
        }

        return user;
    },
    miniUserObject: (user) => {
        return {
            username: user.username,
            discriminator: user.discriminator,
            id: user.id,
            avatar: user.avatar,
            bot: user.bot
        };
    }
};

module.exports = globalUtils;
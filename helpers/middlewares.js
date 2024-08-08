const rateLimit = require('express-rate-limit');
const { logText } = require('./logger');
const globalUtils = require('./globalutils');
const request = require('request');
const wayback = require('./wayback');
const fs = require('fs');
const permissions = require('./permissions');

const config = globalUtils.config;

let cached404s = {};

//Credit to hummus, why does this shit work with typescript but not with js? - Without this function???
function handle(handler) {
	return async function (req, res, next) {
		try {
			return await handler(req, res, next);
		} catch (err) {
			return next(err);
		}
	}
}

async function clientMiddleware(req, res, next) {
    try {
        let cookies = req.cookies;

        if (!cookies) {
            return res.status(400).json({
                code: 400,
                message: "Cookies are required to use the oldcord backend, please enable them and try again."
            })
        }
    
        let build = cookies['release_date'];

        if (!build) {
            return res.redirect("/selector");
        }

        let parts = build.split('_');
        let month = parts[0];
        let day = parts[1];
        let year = parts[2];
        let date = new Date(`${month} ${day} ${year}`);

        req.client_build = build;
        req.client_build_date = date;
        req.channel_types_are_ints = year.includes("2015") ? false : date.getMonth() >= 6;

        return next();
    }
    catch(error) {
        logText(error.toString(), "error");
        
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
};

function rateLimitMiddleware(max, windowMs, ignore_trusted) {
    const rL = rateLimit({
        windowMs: windowMs,
        max: max,
        handler: (req, res, next) => {
            if (ignore_trusted && req.account && config.trusted_users.includes(req.account.id)) {
                return next();
            }    

            const retryAfter = Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()));

            res.status(429).json({
                message: "You are being rate limited.",
                retry_after: retryAfter,
                global: true
            });
        }
    });

    return function (req, res, next) {
        rL(req, res, (err) => {
            if (err) return next(err);
            next();
        });
    }
}

async function assetsMiddleware(req, res) {
    let release = req.cookies['release_date'];

    if (config.cache404s && cached404s[req.params.asset] == 1) {
        return res.status(404).send("File not found");
    }

    if (req.params.asset.includes(".map")) {
        cached404s[req.params.asset] = 1;

        return res.status(404).send("File not found");

        //aint no way you're getting those lol
    }

    if (!fs.existsSync(`${__dirname}/assets/${req.params.asset}`) && !fs.existsSync(`${__dirname}/assets/${req.params.asset}`)) {
        logText(`[LOG] Saving ${req.params.asset} -> https://discordapp.com/assets/${req.params.asset}...`, 'debug');

        let timestamps = await wayback.getTimestamps(`https://discordapp.com/assets/${req.params.asset}`);
        let isOldBucket = false;

        if (timestamps == null || timestamps.first_ts.includes("1999")) {
            timestamps = await wayback.getTimestamps(`https://d3dsisomax34re.cloudfront.net/assets/${req.params.asset}`);

            if (timestamps == null || timestamps.first_ts.includes("1999")) {
                cached404s[req.params.asset] = 1;

                return res.status(404).send("File not found");
            }

            isOldBucket = true;
        }

        let timestamp = timestamps.first_ts;
        let snapshot_url = ``;

        if (isOldBucket) {
            snapshot_url = `https://web.archive.org/web/${timestamp}im_/https://d3dsisomax34re.cloudfront.net/assets/${req.params.asset}`;
        } else snapshot_url = `https://web.archive.org/web/${timestamp}im_/https://discordapp.com/assets/${req.params.asset}`;

        request(snapshot_url, { encoding: null }, (err, resp, body) => {
            if (err) {
                console.log(err);

                cached404s[req.params.asset] = 1;

                return res.status(404).send("File not found");
            }

            if (snapshot_url.endsWith(".js")) {
                let str = Buffer.from(body).toString("utf-8");

                if (release.includes("2015")) {
                    str = globalUtils.replaceAll(str, /d3dsisomax34re.cloudfront.net/g, (config.local_deploy ? config.base_url + ":" + config.port : config.base_url));
                }

                str = globalUtils.replaceAll(str, /cdn.discordapp.com/g, (config.local_deploy ? config.base_url + ":" + config.port : config.base_url));
                str = globalUtils.replaceAll(str, /discord.gg/g, (config.local_deploy ? config.base_url + ":" + config.port : config.base_url) + "/invites");
                
                str = globalUtils.replaceAll(str, /discordapp.com/g, (config.local_deploy ? config.base_url + ":" + config.port : config.base_url));
                
                if (release.includes("2016")) {
                    str = globalUtils.replaceAll(str, "QFusd4xbRKo", "gNEr6tM9Zgc"); //Gifv is gucci
                }
                
                body = Buffer.from(str);

                fs.writeFileSync(`./clients/assets/${req.params.asset}`, str, "utf-8");
            } else if (snapshot_url.endsWith(".css")) {
                let str = Buffer.from(body).toString("utf-8");

                str = globalUtils.replaceAll(str, /d3dsisomax34re.cloudfront.net/g, (config.local_deploy ? config.base_url + ":" + config.port : config.base_url));

                body = Buffer.from(str);

                fs.writeFileSync(`./clients/assets/${req.params.asset}`, str, "utf-8");
            } else {
                fs.writeFileSync(`./clients/assets/${req.params.asset}`, body);
            }

            logText(`[LOG] Saved ${req.params.asset} from ${snapshot_url} successfully.`, 'debug');

            res.writeHead(resp.statusCode, { "Content-Type": resp.headers["content-type"] })
            res.status(resp.statusCode).end(body);
        });
    }
}

async function authMiddleware(req, res, next) {
    try {
        let token = req.headers['authorization'];
        
        if (!token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let account = await globalUtils.database.getAccountByToken(token);
    
        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        req.account = account;

        next();
    }
    catch(err) {
        logText(err.toString(), "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
}

function instanceMiddleware(flag_check) {
    return function (req, res, next) {
        let check = config.instance_flags.includes(flag_check);

        if (check) {
            return res.status(400).json({
                code: 400,
                message: globalUtils.flagToReason(flag_check)
            });
        }

        return next();
    };
}

async function guildMiddleware(req, res, next) {
    if (!req.params.guildid) {
        return next();
    }

    let guild = req.guild;

    if (!guild) {
        return res.status(404).json({
            code: 404,
            message: "Unknown Guild"
        });
    }

    const sender = req.account;

    if (sender == null) {
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }

    let member = await globalUtils.database.getGuildMemberById(guild.id, sender.id);

    if (member == null) {
        return res.status(404).json({
            code: 404,
            message: "Unknown Guild"
        });
    }

    next();
}

async function channelMiddleware(req, res, next) {
    let channel = req.channel;

    if (!channel) {
        return res.status(404).json({
            code: 404,
            message: "Unknown Channel"
        });
    }

    if (!channel.guild_id) {
        return next();
    }

    if (!req.params.guildid) {
        req.params.guildid = channel.guild_id;
    }

    const sender = req.account;

    if (sender == null) {
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }

    let member = await globalUtils.database.getGuildMemberById(channel.guild_id, sender.id);

    if (member == null) {
        return res.status(403).json({
            code: 403,
            message: "Missing Permissions"
        });
    }

    let gCheck = await globalUtils.permissions.hasGuildPermissionTo(req.guild, member.id, "READ_MESSAGES", req.cookies['release_date']);

    if (!gCheck) {
        return res.status(403).json({
            code: 403,
            message: "Missing Permissions"
        });
    }

    let pCheck = await globalUtils.permissions.hasChannelPermissionTo(req.channel, req.guild, member.id, "READ_MESSAGES");

    if (!pCheck) {
        return res.status(403).json({
            code: 403,
            message: "Missing Permissions"
        });
    }

    next();
}

function guildPermissionsMiddleware(permission) {
    return async function (req, res, next) {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (!req.params.guildid) {
            return next();
        }

        const guild = req.guild;

        if (guild == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        if (guild.owner_id == sender.id) {
            return next();
        }

        let check = await globalUtils.permissions.hasGuildPermissionTo(req.guild, sender.id, permission, req.cookies['release_date']);

        if (!check) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        return next();
    }
}

function channelPermissionsMiddleware(permission) {
    return async function (req, res, next) {
        const sender = req.account;

        if (sender == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        if (permission == "MANAGE_MESSAGES" && req.params.messageid) {
            let message = req.message;

            if (message == null) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Message"
                });
            }

            if (message.author.id == sender.id) {
                return next();
            }
        }

        const channel = req.channel;

        if (channel == null) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Channel"
            });
        }

        if (!channel.guild_id && channel.recipient) {
            if (permission == "MANAGE_MESSAGES" && sender.id != channel.recipient.id) {
                return res.status(403).json({
                    code: 403,
                    message: "Missing Permissions"
                });
            }

            if (permission == "SEND_MESSAGES") {
                const theirguilds = await globalUtils.database.getUsersGuilds(channel.recipient.id);
                const myguilds = await globalUtils.database.getUsersGuilds(sender.id);

                let share = false;

                for (var their of theirguilds) {
                    if (their.members != null && their.members.length > 0) {
                        const theirmembers = their.members;

                        if (theirmembers.filter(x => x.id == sender.id).length > 0) {
                            share = true;
                        }
                    }
                }

                for (var mine of myguilds) {
                    if (mine.members != null && mine.members.length > 0) {
                        const mymembers = mine.members;

                        if (mymembers.filter(x => x.id == channel.recipient.id).length > 0) {
                            share = true;
                        }
                    }
                }

                if (!share) {
                    return res.status(403).json({
                        code: 403,
                        message: "Missing Permissions"
                    });
                }
            }

            return next();
        }

        let check = await globalUtils.permissions.hasChannelPermissionTo(channel, req.guild, sender.id, permission);

        if (!check) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        return next();
    }
}

module.exports = {
    clientMiddleware,
    authMiddleware,
    assetsMiddleware,
    instanceMiddleware,
    handle,
    rateLimitMiddleware,
    channelMiddleware,
    guildMiddleware,
    guildPermissionsMiddleware,
    channelPermissionsMiddleware
};
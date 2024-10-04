const rateLimit = require('express-rate-limit');
const { logText } = require('./logger');
const globalUtils = require('./globalutils');
const fetch = require('node-fetch');
const wayback = require('./wayback');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');

const config = globalUtils.config;

let cached404s = {};
let bucket = null;

if (config.gcs_config && config.gcs_config.autoUploadBucket && config.gcs_config.autoUploadBucket !== "") {
    let storage = new Storage();

    bucket = storage.bucket(config.gcs_config.autoUploadBucket);
}

async function clientMiddleware(req, res, next) {
    try {
        if (req.url.includes("/selector") || req.url.includes("/launch") || req.url.includes("/api/admin") || req.url.includes("/webhooks")) return next();

        let cookies = req.cookies;

        if (!cookies) {
            return res.status(400).json({
                code: 400,
                message: "Cookies are required to use the oldcord backend, please enable them and try again."
            })
        }

        if (!globalUtils.addClientCapabilities(cookies['release_date'], req)) {
            return res.redirect("/selector");
        }

        next();
    }
    catch(error) {
        logText(error, "error");
        
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
};

function rateLimitMiddleware(max, windowMs, ignore_trusted = true) {
    const rL = rateLimit({
        windowMs: windowMs,
        max: max,
        handler: (req, res, next) => {
            if (!config.ratelimit_config.enabled) {
                return next();
            }

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
    globalUtils.addClientCapabilities(req.cookies['release_date'], req);
    
    if (config.cache404s && cached404s[req.params.asset] == 1) {
        return res.status(404).send("File not found");
    }

    if (req.params.asset.includes(".map")) {
        cached404s[req.params.asset] = 1;

        return res.status(404).send("File not found");
    }

    const filePath = `./www_dynamic/assets/${req.params.asset}`;

    if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
    }

    let doWayback = true;
    let isOldBucket = false;

    if (req.client_build_date.getFullYear() === 2018 && req.client_build_date.getMonth() >= 6 || req.client_build_date.getFullYear() >= 2019) {
        doWayback = false;
    } //check if older than june 2018 to request from cdn

    async function handleRequest(doWayback) {
        let timestamp = null;
        let snapshot_url = `https://cdn.oldcordapp.com/assets/${req.params.asset}`; //try download from oldcord cdn first

        if (doWayback) {
            let timestamps = await wayback.getTimestamps(`https://discordapp.com/assets/${req.params.asset}`);

            if (timestamps == null || timestamps.first_ts.includes("1999") || timestamps.first_ts.includes("2000")) {
                timestamps = await wayback.getTimestamps(`https://d3dsisomax34re.cloudfront.net/assets/${req.params.asset}`);
    
                if (timestamps == null || timestamps.first_ts.includes("1999") || timestamps.first_ts.includes("2000")) {
                    cached404s[req.params.asset] = 1;
                    
                    return res.status(404).send("File not found");
                }
    
                isOldBucket = true;
            }

            timestamp = timestamps.first_ts;

            if (isOldBucket) {
                snapshot_url = `https://web.archive.org/web/${timestamp}im_/https://d3dsisomax34re.cloudfront.net/assets/${req.params.asset}`;
            } else {
                snapshot_url = `https://web.archive.org/web/${timestamp}im_/https://discordapp.com/assets/${req.params.asset}`;
            }
        }

        logText(`[LOG] Saving ${req.params.asset} from ${snapshot_url}...`, 'debug');

        let r = await fetch(snapshot_url);

        if (!r.ok) {
            console.log(r.statusText);

            cached404s[req.params.asset] = 1;

            return res.status(404).send("File not found");
        }

        if (r.status === 404 && !doWayback) {
            doWayback = true;

            return await handleRequest(doWayback);
        }

        if (r.status >= 400) {
            logText(`!! Error saving asset: ${snapshot_url} - reports ${r.status} !!`, 'debug');
            
            cached404s[req.params.asset] = 1;
            
            return res.status(404).send("File not found");
        }
        
        let bodyText = await r.text();

        if (bucket !== null) {
            let path = `${config.gcs_config.gcStorageFolder}/${req.params.asset}`;

            const cloudFile = bucket.file(path);

            await cloudFile.save(bodyText, { contentType: r.headers.get("content-type") });

            logText(`[LOG] Uploaded ${req.params.asset} to Google Cloud Storage successfully.`, 'debug');
        }

        fs.writeFileSync(filePath, bodyText);

        logText(`[LOG] Saved ${req.params.asset} from ${snapshot_url} successfully.`, 'debug');

        res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") });
        res.status(r.status).end(bodyText);
    }

    await handleRequest(doWayback);
}

function staffAccessMiddleware(privilege_needed) {
    return async function (req, res, next) {
        try {
            let account = req.account;

            if (!account) {
                return res.status(401).json({
                    code: 401,
                    message: "Unauthorized"
                });
            }

            let staffDetails = await global.database.getStaffDetails(account.id);

            if (!staffDetails) {
                return res.status(401).json({
                    code: 401,
                    message: "Unauthorized"
                });
            }

            req.is_staff = staffDetails != null;
            req.staff_details = staffDetails;

            if (staffDetails.privilege < privilege_needed) {
                return res.status(401).json({
                    code: 401,
                    message: "Unauthorized"
                });
            }

            next();
        } catch(err) {
            logText(err, "error");

            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }
    };
}

async function authMiddleware(req, res, next) {
    try {
        if (req.url.includes("/webhooks/") || (req.url.includes("/invite/") && req.method === "GET")) {
            return next();
        } //exclude webhooks and invites from this

        let token = req.headers['authorization'];
        
        req.cannot_pass = false;
        
        if (!token) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let account = await global.database.getAccountByToken(token);
    
        if (!account || account.disabled_until != null) {
            req.cannot_pass = true;
        }
      
        if (!account.bot) {
            if (req.headers.length < 10) {
                req.cannot_pass = true;
            }

            let xSuperProperties = req.headers['X-Super-Properties'];
            let userAgent = req.headers['User-Agent'];
            
            try {
                let decodedProperties = Buffer.from(xSuperProperties, "base64").toString("utf-8");

                if (!xSuperProperties || !userAgent || userAgent.length < 5 || xSuperProperties === "{}" || !decodedProperties || decodedProperties.length < 5) {
                    req.cannot_pass = true;
                }

                if (!/^\{"os":"[^"]+","browser":"[^"]+","device":"[^"]*","referrer":"https?:\/\/[^"]+","referring_domain":"[^"]+"\}$/.test(decodedProperties)) {
                    req.cannot_pass = true;
                }
            } catch {
                req.cannot_pass = true;
            }
        }

        let release_date = req.cookies['release_date'];

        let valid_releases = [
            "june_12_2015",
            "july_10_2015",
            "august_10_2015",
            "september_2_2015",
            "november_6_2015",
            "december_23_2015",
            "january_22_2016",
            "february_9_2016",
            "february_18_2016",
            "march_4_2016",
            "march_18_2016",
            "april_8_2016",
            "may_5_2016",
            "may_19_2016",
            "june_3_2016",
            "june_23_2016",
            "july_11_2016",
            "july_28_2016",
            "august_24_2016",
            "september_8_2016",
            "september_26_2016",
            "october_13_2016",
            "november_3_2016",
            "november_22_2016",
            "december_22_2016",
            "january_23_2017",
            "january_31_2017",
            "march_30_2017",
            "may_3_2017",
            "may_17_2017",
            "july_20_2017",
            "august_17_2017",
            "september_28_2017",
            "october_5_2017",
            "november_16_2017",
            "december_21_2017",
            "january_25_2018",
            "march_7_2018",
            "april_1_2018",
            "april_23_2018",
            "may_28_2018",
            "june_29_2018",
            "august_28_2018",
            "september_29_2018",
            "november_30_2018",
            "december_31_2018",
        ] //forgive me

        if (release_date.length < 2 || typeof release_date !== 'string' || !valid_releases.includes(release_date)) {
            req.cannot_pass = true;
        }

        if (req.cannot_pass) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        req.account = account;

        next();
    }
    catch(err) {
        logText(err, "error");

        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }
}

function instanceMiddleware(flag_check) {
    return function (req, res, next) {
        const flagActive = config.instance_flags.includes(flag_check);

        if (!flagActive) {
            return next();
        }

        if (flag_check === "VERIFIED_EMAIL_REQUIRED" && (!req.account || !req.account.verified)) {
            return res.status(403).json({
                code: 403,
                message: "You must verify your e-mail address to do this action."
            });
        }

        return res.status(400).json({
            code: 400,
            message: globalUtils.flagToReason(flag_check)
        });
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
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    let member = guild.members.find(y => y.id == sender.id);

    if (!member) {
        return res.status(404).json({
            code: 404,
            message: "Unknown Guild"
        });
    }

    next();
}

async function userMiddleware(req, res, next) {
    let account = req.account;

    if (!account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    let user = req.user;

    if (!user) {
        return res.status(404).json({
            code: 404,
            message: "Unknown User"
        });
    }

    let guilds = await global.database.getUsersGuilds(user.id);

    if (guilds.length == 0) {
        return res.status(404).json({
            code: 404,
            message: "Unknown User"
        });
    }

    let share = guilds.some(guild => guild.members != null && guild.members.length > 0 && guild.members.some(member => member.id === account.id));

    if (!share) {
        return res.status(404).json({
            code: 404,
            message: "Unknown User"
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

    if (!sender) {
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }

    if (!req.guild && channel.id.includes('12792182114301050')) return next();

    if (!req.guild) {
        req.guild = await global.database.getGuildById(req.params.guildid); //hate this also
    }

    let member = req.guild.members.find(y => y.id == sender.id);

    if (member == null) {
        return res.status(403).json({
            code: 403,
            message: "Missing Permissions"
        });
    }

    let gCheck = await global.permissions.hasGuildPermissionTo(req.guild, member.id, "READ_MESSAGES", req.client_build);

    if (!gCheck) {
        return res.status(403).json({
            code: 403,
            message: "Missing Permissions"
        });
    }

    let pCheck = await global.permissions.hasChannelPermissionTo(req.channel, req.guild, member.id, "READ_MESSAGES");

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

        let check = await global.permissions.hasGuildPermissionTo(req.guild, sender.id, permission, req.client_build);

        if (!check) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        next();
    }
}

function channelPermissionsMiddleware(permission) {
    return async function (req, res, next) {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
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

        if (channel.id.includes('12792182114301050')) return next();

        if (!channel.guild_id && channel.recipients) {
            if (permission == "MANAGE_MESSAGES" && !channel.recipients.includes(sender.id)) {
                return res.status(403).json({
                    code: 403,
                    message: "Missing Permissions"
                });
            }

            if (permission == "SEND_MESSAGES") {
                if (channel.type == 1) {
                    //Permission to DM
                    
                    //Need a complete user object for the relationships
                    let otherID = channel.recipients[channel.recipients[0].id == sender.id ? 1 : 0].id;
                    let other = await global.database.getAccountByUserId(otherID);

                    if (!other) {
                        return res.status(403).json({
                            code: 403,
                            message: "Missing Permissions"
                        });
                    }

                    let friends = globalUtils.areWeFriends(sender, other);

                    const guilds = await global.database.getUsersGuilds(other.id);

                    const sharedGuilds = guilds.filter(guild => 
                        guild.members != null && 
                        guild.members.length > 0 && 
                        guild.members.some(member => member.id === sender.id)
                    );

                    if (!friends && sharedGuilds.length === 0) {
                        return res.status(403).json({
                            code: 403,
                            message: "Missing Permissions"
                        });
                    }

                    let counted = 0;

                    for(var guild of sharedGuilds) {
                        if (other.settings.restricted_guilds.includes(guild.id)) {
                            counted++;
                        }
                    }

                    if (counted === sharedGuilds.length && !friends) {        
                        return res.status(403).json({
                            code: 403,
                            message: "Missing Permissions"
                        });
                    }
                } else if (channel.type == 3) {
                    //Permission to send in group chat
                    if (!channel.recipients.some(x => x.id == sender.id)) {
                        return res.status(403).json({
                            code: 403,
                            message: "Missing Permissions"
                        });
                    }
                }
            }

            return next();
        }

        let check = await global.permissions.hasChannelPermissionTo(channel, req.guild, sender.id, permission);

        if (!check) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        next();
    }
}

module.exports = {
    clientMiddleware,
    authMiddleware,
    assetsMiddleware,
    instanceMiddleware,
    rateLimitMiddleware,
    staffAccessMiddleware,
    channelMiddleware,
    guildMiddleware,
    userMiddleware,
    guildPermissionsMiddleware,
    channelPermissionsMiddleware
};
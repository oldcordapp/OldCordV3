const express = require('express');
const globalUtils = require('../helpers/globalutils');
const router = express.Router({ mergeParams: true });
const integrationConfig = globalUtils.config.integration_config;
const Twitch = require('../helpers/integrations/twitch');

let pendingCallback = [];

router.get("/:platform/authorize", async (req, res) => {
    let token = req.query.token;
    let platform = req.params.platform;

    if (!token) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        })
    }

    let checkPlatform = integrationConfig.find(x => x.platform == platform);

    if (!checkPlatform) {
        return res.status(400).json({
            code: 400,
            message: "This platform is not currently supported by Oldcord. Try again later."
        });
    }

    pendingCallback.push({
        token: token,
        platform: platform,
        user_agent: req.headers['user-agent'],
        release_date: req.client_build
    });

    return res.redirect(`https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${checkPlatform.client_id}&redirect_uri=${encodeURI(checkPlatform.redirect_uri)}&scope=channel_subscriptions+channel_check_subscription+channel%3Aread%3Asubscriptions&state=3ebc725b6bf7dfd21f353c5e8f91c212`);
});

router.get("/:platform/callback", async (req, res) => {
    let code = req.query.code;
    let platform = req.params.platform;
    //let state = req.params.state;
    let pending = pendingCallback.find(x => x.user_agent == req.headers['user-agent'] && x.release_date == req.client_build);

    if (!pending) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }
    
    let token = pending.token;

    if (!token) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    let account = await global.database.getAccountByToken(token);

    if (!account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    if (platform != "twitch") {
        return res.status(400).json({
            code: 400,
            message: "Unsupported platform"
        })
    }

    if (!code) {
        return res.status(400).json({
            code: 400,
            message: "Something went wrong while connecting your account. Try again later."
        });
    }

    let twitch = new Twitch(code);

    let access_token = await twitch.getAccessToken();

    if (access_token == null) {
        return res.status(400).json({
            code: 400,
            message: "Something went wrong while connecting your account. Try again later."
        });
    }

    let user = await twitch.getUser(access_token);

    if (user == null) {
        return res.status(400).json({
            code: 400,
            message: "Something went wrong while connecting your account. Try again later."
        });
    }

    let attemptAddConnection = await global.database.addConnectedAccount(account.id, platform, user.id, user.login);

    if (!attemptAddConnection) {
        return res.status(400).json({
            code: 400,
            message: "Something went wrong while connecting your account. Try again later."
        });
    }

    pendingCallback = pendingCallback.filter(x => x !== pending);

    await global.dispatcher.dispatchEventTo(account.id, "USER_CONNECTIONS_UPDATE", {});

    return res.status(200).json({
        code: 200,
        message: "Success"
    });
});

module.exports = router;
const request = require('request-promise');
const globalUtils = require('../globalutils');
const { logText } = require('../logger');
const twitchConfig = globalUtils.config.integration_config.find(x => x.platform == "twitch");

class Twitch {
    constructor(code) {
        this.code = code;
    }
    async getAccessToken () {
        const options = {
            method: 'POST',
            url: 'https://id.twitch.tv/oauth2/token',
            form: {
                client_id: twitchConfig.client_id,
                client_secret: twitchConfig.client_secret,
                code: this.code,
                grant_type: 'authorization_code',
                redirect_uri: twitchConfig.redirect_uri
            },
            json: true
        };

        try {
            const response = await request(options);

            return response.access_token;
        } catch (error) {
            logText(error, "error");

            return null;
        }
    }
    async getUser(access_token) {
        if (!twitchConfig) return null;

        const options = {
            url: 'https://api.twitch.tv/helix/users',
            headers: {
                'Client-ID': twitchConfig.client_id,
                'Authorization': `Bearer ${access_token}`
            },
            json: true
        };
    
        try {
            const response = await request(options);

            return response.data[0];
        } catch (error) {
            logText(error, "error");

            return null;
        }
    }
}

module.exports = Twitch;
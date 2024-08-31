const fetch = require('node-fetch');
const globalUtils = require('../globalutils');
const { logText } = require('../logger');
const twitchConfig = globalUtils.config.integration_config.find(x => x.platform == "twitch");

class Twitch {
    constructor(code) {
        this.code = code;
    }
    async getAccessToken () {
        if (!twitchConfig) return null;
        
        const form = new FormData();
        
        form.append("client_id", twitchConfig.client_id);
        form.append("client_secret", twitchConfig.client_secret);
        form.append("code", this.code);
        form.append("grant_type", 'authorization_code');
        form.append("redirect_uri", twitchConfig.redirect_uri);
        
        const options = {
            method: 'POST',
            body: form,
        };

        try {
            const response = await (await fetch('https://id.twitch.tv/oauth2/token', options)).json();

            return response.access_token;
        } catch (error) {
            logText(error, "error");

            return null;
        }
    }
    async getUser(access_token) {
        if (!twitchConfig) return null;

        const options = {
            headers: {
                'Client-ID': twitchConfig.client_id,
                'Authorization': `Bearer ${access_token}`
            },
        };
    
        try {
            const response = await (await fetch('https://api.twitch.tv/helix/users', options)).json();

            return response.data[0];
        } catch (error) {
            logText(error, "error");

            return null;
        }
    }
}

module.exports = Twitch;
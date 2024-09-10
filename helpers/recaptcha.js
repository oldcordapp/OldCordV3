const fetch = require('node-fetch');

module.exports = {
    verify: async (answer) => {
        if (!global.config.captcha_config.secret_key) return false;

        if (answer === null) return false;

        const params = new URLSearchParams();

        params.append('secret', global.config.captcha_config.secret_key);
        params.append('response', answer);

        let response = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        let data = await response.json();

        return data.success;
    }
};
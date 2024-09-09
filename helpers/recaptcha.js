const fetch = require('node-fetch');

module.exports = {
    verify: async (answer) => {
        if (global.config['recaptchav2-secret'] === "") return false;

        if (answer === null) return false;

        const params = new URLSearchParams();

        params.append('secret', global.config['recaptchav2-secret']);
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
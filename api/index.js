const express = require('express');
const { authMiddleware } = require('../helpers/middlewares');
const app = express();
const globalUtils = require('../helpers/globalutils');
const config = globalUtils.config;
const auth = require('./auth');
const tutorial = require('./tutorial');
const users = require('./users/index');
const voice = require('./voice');
const guilds = require('./guilds');
const invites = require('./invites');
const channels = require('./channels');

app.use("/auth", auth);

app.use(authMiddleware);

app.use("/tutorial", tutorial);
app.use("/users", users);
app.use("/voice", voice);
app.use("/guilds", guilds);
app.use("/invite", invites);
app.use("/channels", channels);

app.use("/track", (_, res) => {
    return res.status(204).send();
});

app.get("/gateway", (req, res) => {
    return res.status(200).json({
        url: `${config.use_wss ? 'wss' : 'ws'}://${config.gateway == "" ? req.headers['host']?.split(':')[0] : config.gateway}${config.gateway_has_no_port ? '' : `:${config.use_same_port ? config.port : config.ws_port}`}`
    });
});

module.exports = app;
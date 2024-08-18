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
const connections = require('./connections');

app.use("/auth", auth);
app.use("/connections", connections);

app.get("/incidents/unresolved.json", (req, res) => {
    return res.status(200).json({
        scheduled_maintenances: [],
        incidents: []
    });
});

app.get("/scheduled-maintenances/upcoming.json", (req, res) => {
    return res.status(200).json({
        scheduled_maintenances: []
    });
});

app.get("/scheduled-maintenances/active.json", (req, res) => {
    return res.status(200).json({
        scheduled_maintenances: [],
        incidents: []
    });
});

app.get("/gateway", (req, res) => {
    let host = req.headers['host'];
    if (host) host = host.split(':', 2)[0];
    return res.status(200).json({
        url: `${config.secure ? 'wss' : 'ws'}://${config.gateway_url == "" ? (host ?? config.base_url) : config.gateway_url}:${config.ws_port}`
    });
});

app.use(authMiddleware);

app.use("/tutorial", tutorial);
app.use("/users", users);
app.use("/voice", voice);
app.use("/guilds", guilds);
app.use("/channels", channels);
app.use("/invite", invites);

app.use("/track", (_, res) => {
    return res.status(204).send();
});

module.exports = app;
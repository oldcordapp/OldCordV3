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
const admin = require('./admin');
const webhooks = require('./webhooks');
const store = require('./store');

global.config = globalUtils.config;
//just in case

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

app.get("/experiments", (req, res) => {
    return res.status(200).json({assignments:[]});
});

app.get("/promotions", (req, res) => {
    return res.status(200).json([]);
});

app.get("/applications", (req, res) => {
    return res.status(200).json([]);
});

app.get("/activities", (req, res) => {
    return res.status(200).json([]);
});

app.get("/applications/detectable", (req, res) => {
    return res.status(200).json([]);
});

app.get("/games", (req, res) => {
    return res.status(200).json([]);
});

app.get("/gateway", (req, res) => {
    return res.status(200).json({
        url: globalUtils.generateGatewayURL(req)
    });
});

app.use(authMiddleware);

app.use("/admin", admin);
app.use("/tutorial", tutorial);
app.use("/users", users);
app.use("/voice", voice);
app.use("/guilds", guilds);
app.use("/channels", channels);
app.use("/invite", invites);
app.use("/webhooks", webhooks);
app.use("/store", store);

app.use("/track", (_, res) => {
    return res.status(204).send();
});

module.exports = app;
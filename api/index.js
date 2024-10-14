const express = require('express');
const { authMiddleware, instanceMiddleware } = require('../helpers/middlewares');
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
const oauth2 = require('./oauth2/index');
const entitlements = require('./entitlements');
const activities = require('./activities');

global.config = globalUtils.config;
//just in case

app.use("/auth", auth);
app.use("/connections", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), connections);

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

app.use("/admin", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), admin);
app.use("/tutorial", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), tutorial);
app.use("/users", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), users);
app.use("/voice", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), voice);
app.use("/guilds", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), guilds);
app.use("/channels", channels);
app.use("/entitlements", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), entitlements);
app.use("/activities", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), activities);
app.use("/invite", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), invites);
app.use("/webhooks", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), webhooks);
app.use("/oauth2", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), oauth2);
app.use("/store", instanceMiddleware("VERIFIED_EMAIL_REQUIRED"), store);

app.use("/track", (_, res) => {
    return res.status(204).send();
});

app.use("/science", (_, res) => {
    return res.status(204).send();
});

module.exports = app;
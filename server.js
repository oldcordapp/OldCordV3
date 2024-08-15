const express = require('express');
const gateway = require('./gateway');
const cors = require('cors');
const fs = require('fs');
const { createServer } = require('http');
const https = require('https');
const { logText } = require('./helpers/logger');
const database = require('./helpers/database');
const cookieParser = require('cookie-parser');
const path = require('path');
const globalUtils = require('./helpers/globalutils');
const { assetsMiddleware, clientMiddleware } = require('./helpers/middlewares');
const router = require('./api/index');
const Jimp = require('jimp');
const dispatcher = require('./helpers/dispatcher');
const permissions = require('./helpers/permissions');
const modules = require('./api/modules');
const download = require('./api/download');
const updates = require('./api/updates');
const config = globalUtils.config;
const app = express();

app.set('trust proxy', 1);

if (config.use_same_port) {
    if (config.use_wss && config.key_path != "" && config.cert_path != "") {
        let server = https.createServer({
            cert: fs.readFileSync(config.cert_path),
            key: fs.readFileSync(config.key_path)
        });
        
        global.dispatcher = dispatcher;
        global.gateway = gateway;
        global.sessions = new Map();
        global.userSessions = new Map();

        gateway.ready(server);

        database.setupDatabase();

        global.database = database;
        global.permissions = permissions;

        server.listen(config.port, () => {
            console.log("[OLDCORDV3] <RECONNECT TO A BETTER TIME>: Online!");
        });
    
        server.on('request', app);
    } else {
        let server = createServer();

        global.dispatcher = dispatcher;
        global.gateway = gateway;
        global.sessions = new Map();
        global.userSessions = new Map();

        gateway.ready(server);

        database.setupDatabase();

        global.database = database;
        global.permissions = permissions;

        server.listen(config.port, () => {
            console.log("[OLDCORDV3] <RECONNECT TO A BETTER TIME>: Online!");
        })
    
        server.on('request', app);
    }
} else {
    global.dispatcher = dispatcher;
    global.gateway = gateway;
    global.sessions = new Map();
    global.userSessions = new Map();

    gateway.regularReady(config.ws_port)

    database.setupDatabase();

    global.database = database;
    global.permissions = permissions;

    app.listen(config.port, () => {
        console.log(`[OLDCORDV3] <RECONNECT TO A BETTER TIME>: Online! Gateway port: ${config.ws_port} - HTTP port: ${config.port}`);
    });
}

app.use(express.json({
    limit: '10mb',
}));

app.use(cookieParser());

app.use(cors());

app.get('/attachments/:guildid/:channelid/:filename', async (req, res) => {
    const baseFilePath = path.join(__dirname, 'user_assets', 'attachments', req.params.guildid, req.params.channelid, req.params.filename);
    
    try {
        let { width, height } = req.query;
        const url = req.url;

        if (!url || !width || !height || url.includes(".gif")) {
            return res.status(200).sendFile(baseFilePath);
        }

        if (parseInt(width) > 800) {
            width = '800';
        }

        if (parseInt(height) > 800) {
            height = '800';
        }

        const mime = req.params.filename.endsWith(".jpg") ? 'image/jpeg' : 'image/png';

        const resizedFileName = `${req.params.filename.split('.').slice(0, -1).join('.')}_${width}_${height}.${mime.split('/')[1]}`;
        const resizedFilePath = path.join(__dirname, 'user_assets', 'attachments', req.params.guildid, req.params.channelid, resizedFileName);

        if (fs.existsSync(resizedFilePath)) {
            return res.status(200).type(mime).sendFile(resizedFilePath);
        }

        const imageBuffer = fs.readFileSync(baseFilePath);

        const image = await Jimp.read(imageBuffer);

        image.resize(parseInt(width), parseInt(height));

        const resizedImage = await image.getBufferAsync(mime);

        fs.writeFileSync(resizedFilePath, resizedImage);

        return res.status(200).type(mime).sendFile(resizedFilePath);
    }
    catch(err) {
        logText(err, "error");
        return res.status(200).sendFile(baseFilePath);
    }
});

app.get('/icons/:serverid/:file', async (req, res) => {
    try {
        const directoryPath = path.join(__dirname, 'user_assets', 'icons', req.params.serverid);

        if (!fs.existsSync(directoryPath)) {
            return res.status(404).send("File not found");
        }

        const files = fs.readdirSync(directoryPath);
        const matchedFile = files.find(file => file.startsWith(req.params.file.split('.')[0]));

        if (!matchedFile) {
            return res.status(404).send("File not found");
        }

        const filePath = path.join(directoryPath, matchedFile);

        return res.status(200).sendFile(filePath);
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

app.get('/avatars/:userid/:file', async (req, res) => {
    try {
        const directoryPath = path.join(__dirname, 'user_assets', 'avatars', req.params.userid);

        if (!fs.existsSync(directoryPath)) {
            return res.status(404).send("File not found");
        }

        const files = fs.readdirSync(directoryPath);
        const matchedFile = files.find(file => file.startsWith(req.params.file.split('.')[0]));

        if (!matchedFile) {
            return res.status(404).send("File not found");
        }

        const filePath = path.join(directoryPath, matchedFile);

        return res.status(200).sendFile(filePath);
    }
    catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

app.get("/emojis/:file", async (req, res) => {
    try {
        const directoryPath = path.join(__dirname, 'user_assets', 'emojis');

        if (!fs.existsSync(directoryPath)) {
            return res.status(404).send("File not found");
        }

        const files = fs.readdirSync(directoryPath);
        const matchedFile = files.find(file => file.startsWith(req.params.file.split('.')[0]));

        if (!matchedFile) {
            return res.status(404).send("File not found");
        }

        const filePath = path.join(directoryPath, matchedFile);

        return res.status(200).sendFile(filePath);
    }
    catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

app.use('/assets', express.static(__dirname + '/clients/assets'));

app.use("/assets/:asset", assetsMiddleware);

/* Modern Desktop Client Stuff - START 
 - Credits to deskehs for their work on this
*/

app.use("/api/updates", updates);

app.use("/api/modules", modules);

app.use("/download", download);

app.use("/api/download", download);

/* Modern Desktop Client Stuff - END */

app.use(clientMiddleware);

app.get("/api/users/:userid/avatars/:file", async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'user_assets', 'avatars', req.params.userid, req.params.file);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File not found");
        }

        return res.status(200).sendFile(filePath);
    }
    catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

app.use("/api/v6/", router);

app.use("/api/v2/", router);

app.use("/api/", router);

app.use("/api/v*/", (_, res) => {
    return res.status(400).json({
        code: 400,
        message: "Invalid API Version"
    });
});

if (config.serveSelector) {
    app.get("/selector", (_, res) => {
        return res.send(fs.readFileSync(`./clients/assets/selector/selector.html`, 'utf8'));
    });
}

app.get("/launch", (req, res) => {
    if (!req.query.release_date) {
        return res.redirect("/selector");
    }
    
    res.cookie('release_date', req.query.release_date);

    res.redirect("/");
});

app.get("/channels/:guildid/:channelid", (_, res) => {
    return res.redirect("/");
});

/*
app.get("/widget", (req, res) => {
    try {
        if (!req.client_build) {
            return res.redirect("/selector");
        }

        if (!fs.existsSync(`./clients/assets/${req.client_build}`)) {
            return res.redirect("/selector");
        }

        res.send(fs.readFileSync(`./clients/assets/${req.client_build}/widget.html`, 'utf8'));
    }
    catch(error) {
        logText(error, "error");

        return res.redirect("/selector");
    }
});
*/

/*
app.get('/developers/*', (req, res) => {
	try {
        if (!req.client_build) {
            return res.redirect("/selector");
        }

        if (!fs.existsSync(`./clients/assets/${req.client_build}`)) {
            return res.redirect("/selector");
        }

        let year = req.client_build.split('_')[2];

        if (year.includes("2015")) {
            return res.redirect("https://www.youtube.com/watch?v=jeg_TJvkSjg"); //wtf r u doing lol
        }

        res.send(fs.readFileSync(`./clients/assets/developer_${year}/app.html`, 'utf8'));
    }
    catch(error) {
        logText(error, "error");

        return res.redirect("/selector");
    }
});

app.get('/developers', (req, res) => {
	res.redirect('/developers/');
});
*/

app.get("*", (req, res) => {
    try {
        if (!req.client_build) {
            return res.redirect("/selector");
        }

        if (!fs.existsSync(`./clients/assets/${req.client_build}`)) {
            return res.redirect("/selector");
        }

        let appFile = fs.readFileSync(`./clients/assets/${req.client_build}/app.html`, 'utf8');

        if (config.patcher_location !== "") {
            let patcherFile = fs.readFileSync(config.patcher_location, "utf8");

            appFile += `\n<script>${patcherFile}</script>`;
        }

        res.send(appFile);
    }
    catch(error) {
        logText(error, "error");

        return res.redirect("/selector");
    }
});
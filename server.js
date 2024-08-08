const express = require('express');
const gateway = require('./gateway');
const cors = require('cors');
const fs = require('fs');
const { createServer } = require('http');
const https = require('https');
const { logText } = require('./helpers/logger');
const database = require('./helpers/database');
const cookieParser = require('cookie-parser');
const NodeCache = require('node-cache');
const path = require('path');
const globalUtils = require('./helpers/globalutils');
const { assetsMiddleware, clientMiddleware } = require('./helpers/middlewares');
const router = require('./api/index');
const Jimp = require('jimp');
const dispatcher = require('./helpers/dispatcher');
const permissions = require('./helpers/permissions');
const config = globalUtils.config;
const cache = new NodeCache({ stdTTL: 600, checkPeriod: 120 });
const app = express();

app.set('trust proxy', 1);

if (config.use_same_port) {
    if (config.use_wss && config.key_path != "" && config.cert_path != "") {
        let server = https.createServer({
            cert: fs.readFileSync(config.cert_path),
            key: fs.readFileSync(config.key_path)
        });

        gateway.setDispatcher(dispatcher);
        gateway.ready(server);

        database.setupDatabase();
        globalUtils.setupShit(database, permissions);

        server.listen(config.port, () => {
            console.log("[OLDCORDV3] <RECONNECT TO A BETTER TIME>: Online!");
        });
    
        server.on('request', app);
    } else {
        let server = createServer();

        gateway.setDispatcher(dispatcher);
        gateway.ready(server);

        database.setupDatabase();
        globalUtils.setupShit(database, permissions);

        server.listen(config.port, () => {
            console.log("[OLDCORDV3] <RECONNECT TO A BETTER TIME>: Online!");
        })
    
        server.on('request', app);
    }
} else {
    gateway.setDispatcher(dispatcher);
    gateway.regularReady(config.ws_port);

    database.setupDatabase();
    globalUtils.setupShit(database, permissions);

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
    const path2 = path.join(__dirname, 'user_assets', 'attachments', req.params.guildid, req.params.channelid, req.params.filename);
    
    try {
        let { width, height } = req.query;
        const url = req.url;
        
        if (!url || !width || !height || url.includes(".gif")) {
            return res.status(200).sendFile(path2);
        }

        if (parseInt(width) > 800) {
            width = '800';
        }

        if (parseInt(height) > 800) {
            height = '800';
        }

        const cacheKey = `${url}-${width}-${height}`;
        const cachedImage = cache.get<Buffer>(cacheKey);
        
        const mime = req.params.filename.endsWith(".jpg") ? 'image/jpeg' : 'image/png';
      
        if (cachedImage) {
            return res.status(200).type(mime).send(cachedImage);
        }

        const imageBuffer = fs.readFileSync(path2);

        const image = await Jimp.read(imageBuffer);

        image.resize(parseInt(width), parseInt(height));

        const resizedImage = await image.getBufferAsync(mime);

        cache.set(cacheKey, resizedImage);

        return res.status(200).type(mime).send(resizedImage);
    }
    catch(err) {
        logText(err.toString(), "error");
    
        return res.status(200).sendFile(path2);
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
        logText(err.toString(), "error");

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
        logText(error.toString(), "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

app.use('/assets', express.static(__dirname + '/clients/assets'));

app.use("/assets/:asset", assetsMiddleware);

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

app.get("*", (req, res) => {
    try {
        if (!req.cookies['release_date']) {
            return res.redirect("/selector");
        }

        if (!fs.existsSync(`./clients/assets/${req.cookies['release_date']}`)) {
            return res.redirect("/selector");
        }

        res.send(fs.readFileSync(`./clients/assets/${req.cookies['release_date']}/app.html`, 'utf8'));
    }
    catch(error) {
        logText(error.toString(), "error");

        return res.redirect("/selector");
    }
});

app.use(clientMiddleware);
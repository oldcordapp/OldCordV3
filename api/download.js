const express = require('express');
const router = express.Router();
const fs = require("fs");
const path = require("path");

const distributionFolder = path.join(__dirname, "..", "distribution");

const setupNames = JSON.parse(
    fs.readFileSync(path.join(distributionFolder, "setup_names.json"), {
        encoding: "utf-8",
    })
);

router.get("/patched/:hostOrModule/:version/:file", async (req, res) => {
    try {
        res.header("Cntent-Length", fs.statSync(path.join(distributionFolder, "patched", req.params.hostOrModule, req.params.version, req.params.file)).size);

        if (req.params.file.includes(".distro")) {
            res.header("Content-Type", "application/octet-stream");
        }

        const stream = fs.createReadStream(
            path.join(
                __dirname,
                "..",
                "distribution",
                "patched",
                req.params.hostOrModule,
                req.params.version,
                req.params.file
            )
        );

        return res.send(stream);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.get("/", async (req, res) => {
    try {
        let pathToDownload;

        if (req.query.platform === "win") {
            res.header("Content-Type", "application/vnd.microsoft.portable-executable");
    
            pathToDownload = path.join(distributionFolder, "download", "win", setupNames.windows);
    
            res.header("Content-Disposition", `attachment; filename=${setupNames.windows}`);
        }
    
        if (!pathToDownload) {
            return res.status(204).send();
        }
    
        res.header("Content-Length", fs.statSync(pathToDownload).size);
    
        const stream = fs.createReadStream(pathToDownload);
    
        return res.send(stream);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
const express = require('express');
const { logText } = require('../helpers/logger');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const distributionFolder = path.join(__dirname, "..", "distribution");
const cacheFolder = path.join(distributionFolder, "cache");
const windowsCacheFile = path.join(cacheFolder, "windows.json");
const moduleVersionFile = path.join(cacheFolder, "module_versions.json");

const patched_versions = JSON.parse(
    fs.readFileSync(path.join(distributionFolder, "patched_versions.json"), {
        encoding: "utf-8",
    })
);

router.get("/windows/distributions/app/manifests/latest", async (req, res) => {
    try {
        const cache = fs.readFileSync(windowsCacheFile, {
            encoding: "utf-8",
        });

        let moduleVersions = fs.readFileSync(moduleVersionFile, {
            encoding: "utf-8",
        });

        let updateInfo;

        if (Math.abs(new Date() - fs.statSync(windowsCacheFile).mtime) >= 14400000 || cache === "") {
            updateInfo = await (
                await fetch(
                  "https://updates.discord.com/distributions/app/manifests/latest?channel=stable&platform=win&arch=x64"
                )
            ).json();

            fs.writeFileSync(windowsCacheFile, JSON.stringify(updateInfo));
        } else updateInfo = JSON.parse(cache);

        if (moduleVersions == "") {
            moduleVersions = {};

            for (const module of Object.keys(updateInfo.modules)) {
                if (!Object.keys(patched_versions.modules).includes(module)) {
                    moduleVersions[module] = updateInfo.modules[module].full.module_version;
                }
            }
            
            fs.writeFileSync(moduleVersionFile, JSON.stringify(moduleVersions));
        } else moduleVersions = JSON.parse(moduleVersions);

        if (cache !== "" && JSON.parse(cache).full.host_version.toString() !== updateInfo.full.host_version.toString()) {
            for (const module of Object.keys(moduleVersions)) {
                moduleVersions[module] = moduleVersions[module] + 1;
            }
        }

        updateInfo.full.host_version = patched_versions.host.version;
        updateInfo.full.package_sha256 = patched_versions.host.sha256;
        updateInfo.full.url = `${req.protocol}://${req.hostname}/download/patched/host/${patched_versions.host.version.join(".")}/${
            patched_versions.host.files.windows.full
        }`;
        // updateInfo.deltas.map((x) => {x.host_version = [2024, 8, 1]; return x})
        updateInfo.deltas = [];

        for (const module of Object.keys(updateInfo.modules)) {
            if (Object.keys(patched_versions.modules).includes(module)) {
                updateInfo.modules[module].full.module_version = patched_versions.modules[module].version;
                updateInfo.modules[module].full.package_sha256 = patched_versions.modules[module].sha256;
                updateInfo.modules[module].full.url = `${req.protocol}://${req.hostname}/download/patched/${module}/${patched_versions.modules[module].version}/${patched_versions.modules[module].files.windows.full}`;
            } else updateInfo.modules[module].full.module_version = moduleVersions[module];
            
            updateInfo.modules[module].full.host_version = patched_versions.host.version;
            updateInfo.modules[module].deltas = [];
        }
        
        return res.status(200).json(updateInfo);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
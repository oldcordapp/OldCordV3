const path = require('path');
const fs = require('fs');
const express = require('express');
const fetch = require('node-fetch');
const contentDisposition = require('content-disposition');
const router = express.Router();

const distributionFolder = path.join(__dirname, '../', 'distribution');
const cacheFolder = path.join(distributionFolder, 'cache');
const windowsCacheFile = path.join(cacheFolder, 'windows.json');
const moduleVersionFile = path.join(cacheFolder, 'module_versions.json');
const hostVersionFile = path.join(cacheFolder, 'host_version.json');

let isUsingObjectStorage = false;

if (!fs.existsSync(windowsCacheFile)) {
    fs.closeSync(fs.openSync(windowsCacheFile, 'w'));
}

if (!fs.existsSync(moduleVersionFile)) {
    fs.closeSync(fs.openSync(moduleVersionFile, 'w'));
}

if (!fs.existsSync(hostVersionFile)) {
    fs.writeFileSync(
        hostVersionFile,
        JSON.stringify({ windows: null, macOS: null, linux: null })
    );
}

const patched_versions = JSON.parse(
    fs.readFileSync(path.join(distributionFolder, 'patched_versions.json'), {
        encoding: 'utf-8',
    })
);

const setupNames = JSON.parse(
    fs.readFileSync(path.join(distributionFolder, 'setup_names.json'), {
        encoding: 'utf-8',
    })
);

function setDownloadHeaders(res, downloadPath) {
    if (downloadPath.includes('win')) {
        res.header(
            'content-type',
            'application/vnd.microsoft.portable-executable'
        );
        res.header(
            'content-disposition',
            `attachment; filename=${setupNames.windows}`
        );
    }
}

// tar.br files need to be application/octet-stream
function setPatchedHeaders(res, downloadPath, stat) {
    res.header('X-Content-Length', stat.size);
    if (downloadPath.includes('.distro')) {
        res.header('content-type', 'application/octet-stream');
    }
    res.header('content-disposition', contentDisposition(downloadPath));
}  

router.use(
    '/download/setup',
    express.static(path.join(distributionFolder, 'download'), {
        index: false,
        setHeaders: setDownloadHeaders,
    })
);

router.use(
    '/download/patched',
    express.static(path.join(distributionFolder, 'patched'), {
        index: false,
        setHeaders: setPatchedHeaders,
    })
);

router.get(
    '/api/updates/windows/distributions/app/manifests/latest',
    async (req, res) => {
        let updateInfo = fs.readFileSync(windowsCacheFile, { encoding: 'utf-8' });
        const hostVersion = JSON.parse(
            fs.readFileSync(hostVersionFile, { encoding: 'utf-8' })
        );
        let moduleVersions = fs.readFileSync(moduleVersionFile, { encoding: 'utf-8' });

        if (
            Math.abs(new Date() - fs.statSync(windowsCacheFile).mtime) >= 14400000 ||
            updateInfo === ''
        ) {
            updateInfo = await (
                await fetch(
                    'https://updates.discord.com/distributions/app/manifests/latest?channel=stable&platform=win&arch=x64'
                )
            ).json();
            fs.writeFileSync(windowsCacheFile, JSON.stringify(updateInfo));

            if (hostVersion.windows === null) {
                hostVersion.windows = updateInfo.full.host_version;
                fs.writeFileSync(hostVersionFile, JSON.stringify(hostVersion));
            }
        } else {
            updateInfo = JSON.parse(updateInfo);
        }

        if (moduleVersions === '') {
            moduleVersions = {};
            for (const module of Object.keys(updateInfo.modules)) {
                if (!Object.keys(patched_versions.modules).includes(module)) {
                    moduleVersions[module] = updateInfo.modules[module].full.module_version;
                }
            }
            fs.writeFileSync(moduleVersionFile, JSON.stringify(moduleVersions));
        } else {
            moduleVersions = JSON.parse(moduleVersions);
        }

        if (
            hostVersion.windows !== null &&
            hostVersion.windows.toString() !== updateInfo.full.host_version.toString()
        ) {
            hostVersion.windows = updateInfo.full.host_version;
            fs.writeFileSync(hostVersionFile, JSON.stringify(hostVersion));

            for (const module of Object.keys(moduleVersions)) {
                moduleVersions[module] = moduleVersions[module] + 1;
            }
        }

        updateInfo.full.host_version = patched_versions.host.version;
        updateInfo.full.package_sha256 = patched_versions.host.sha256;
        updateInfo.full.url = isUsingObjectStorage
            ? patched_versions.host.files.windows.full
            : `${req.protocol}://${req.get('Host')}/download/patched/host/${patched_versions.host.version.join('.')}/${patched_versions.host.files.windows.full}`;

        updateInfo.deltas = [];

        for (const module of Object.keys(updateInfo.modules)) {
            if (Object.keys(patched_versions.modules).includes(module)) {
                updateInfo.modules[module].full.module_version =
                    patched_versions.modules[module].version;
                updateInfo.modules[module].full.package_sha256 =
                    patched_versions.modules[module].sha256;
                updateInfo.modules[module].full.url = isUsingObjectStorage
                    ? patched_versions.modules[module].files.windows.full
                    : `${req.protocol}://${req.get('Host')}/download/patched/${module}/${patched_versions.modules[module].version}/${patched_versions.modules[module].files.windows.full}`;
            } else {
                updateInfo.modules[module].full.module_version = moduleVersions[module];
            }
            updateInfo.modules[module].full.host_version = patched_versions.host.version;
            updateInfo.modules[module].deltas = [];
        }

        return res.status(200).json(updateInfo);
    }
);

router.get('/api/updates/stable', async (req, res) => {
    return res.status(204).send();
});

router.get('/api/modules/stable/versions.json', async (req, res) => {
    return res.status(204).send();
});

router.get('/api/download', function (req, res) {
    let pathToDownload;
    switch (req.query.platform) {
        case 'win': {
            pathToDownload = setupNames.windows;
            break;
        }
    }

    if (!isUsingObjectStorage) {
        res.redirect(`../../download/setup/${req.query.platform}/${pathToDownload}`);
    } else {
        res.redirect(pathToDownload);
    }
});

module.exports = router;
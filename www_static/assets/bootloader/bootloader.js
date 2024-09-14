window.__require = window.require;
window.__OVERLAY__ = window.overlay != null;

window.cdn_url = "https://cdn.oldcordapp.com";

let config;
function loadLog(text, error, noLog) {
    if (!noLog)
        console.log(text);

    const loadingTxt = document.getElementById("loadingTxt");
    if (!loadingTxt)
        return;

    const elm = document.createElement("div");
    elm.innerText = text;
    if (error)
        elm.style.color = "#ff4141";
    loadingTxt.appendChild(elm);
}

function noop() {}

let release_date = (function() {
	const parts = `; ${document.cookie}`.split("; release_date=");
	if (parts.length === 2)
		return parts.pop().split(';').shift();
})();

function patchJS(script, kind) {
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }
    
    //Fix client misidentification
    script = script.replace('__[STANDALONE]__', '');
    
    //Branding
    if (!release_date.endsWith("_2018") && !release_date.endsWith("_2019")) {
        //TODO: Fix for 2018+
        function sanitize(js) {
            return js.replaceAll(/"/g, '"').replaceAll(/\n|\r/g, "");
        }
        script = script.replaceAll(/\"Discord\"|'Discord'/g, `"${sanitize(config.instance_name)}"`);
    }
    
    //Disable HTTPS in insecure mode (for local testing)
    if (location.protocol != "https")
        script = script.replaceAll("https://", location.protocol + "//");

    //Make fields consistent
    if (release_date.endsWith("_2015"))
        script = script.replaceAll(".presence.", ".presences.");

    //Set URLs
    script = script.replaceAll(/d3dsisomax34re.cloudfront.net/g, location.host);
    script = script.replaceAll(/status.discordapp.com/g, location.host);
    script = script.replaceAll(/cdn.discordapp.com/g, location.host);
    script = script.replaceAll(/discordcdn.com/g, location.host); //??? DISCORDCDN.COM?!!11
    script = script.replaceAll(/discord.gg/g, config.custom_invite_url);
    script = script.replaceAll(/discordapp.com/g, location.host);
    script = script.replaceAll(/([a-z]+\.)?discord.media/g, location.host);
    
    script = script.replaceAll(/e\.exports=n\.p/g, `e.exports="${cdn_url}/assets/"`);
    
    //Do NOT interact with sentry. Better to error than send telemetry.
    script = script.replaceAll("sentry.io", "0.0.0.0");
    
    //Use unified UserSearch worker script
    window.userSearchWorker = function(url) {
        const wwScript = `importScripts("${cdn_url}/assets/UserSearch.worker.js");`;
        return URL.createObjectURL(new Blob([ wwScript ], { type: "text/javascript" }));
    }
    script = script.replace(/n\.p\+"[a-z0-9]+\.worker\.js"/, `window.userSearchWorker()`);

    //Enable april fools @someone experiment
    if (release_date == "april_1_2018" || release_date == "april_23_2018")
        script = script.replaceAll("null!=e&&e.bucket!==f.ExperimentBuckets.CONTROL", "true");

    //Allow emojis anywhere
    script = script.replace(/isEmojiDisabled:function\([^)]*\){/, "$&return false;");
    script = script.replaceAll(/=t.invalidEmojis/g, "=[]");

    //Recaptcha support
    if (config.captcha_options.enabled)
        script = script.replaceAll("6Lef5iQTAAAAAKeIvIY-DeexoO3gj7ryl9rLMEnn", config.captcha_options.site_key);

    //Disable telemetry
    script = script.replace(/track:function\([^)]*\){/, "$&return;");
    script = script.replace(/(function \w+\(e\)){[^p]*post\({.*url:\w\.Endpoints\.TRACK[^}]*}\)}/, "$1{}");
    script = script.replace(/return \w\["default"\]\.post\(.*url:\w\.Endpoints\.TRACK[^}]*}[^)]*?\)/g, "null;");
    script = script.replace(/\w\["default"\]\.post\(.*url:\w\.Endpoints\.TRACK[^}]*}[^)]*?\)/g, "");
    script = script.replace(/t\.analyticsTrackingStoreMaker=function\(e\){/, "t\.analyticsTrackingStoreMaker=function(e){return;");

    //Replace text
    function replaceMessage(name, oldValue, value) {
        script = script.replaceAll(new RegExp(`${name}:".*?"`, "g"), `${name}:"${value}"`);
        if (oldValue)
            script = script.replaceAll(new RegExp(`"${oldValue}"`, "gi"), `"${value}"`);
    }
    replaceMessage("FORM_LABEL_SERVER_REGION", "Server Region", "Server Era");
    replaceMessage("ONBOARDING_GUILD_SETTINGS_SERVER_REGION", "Server Region", "Server Era");
    replaceMessage("REGION_SELECT_HEADER", null, "Select a server era");
    replaceMessage("REGION_SELECT_FOOTER", null, "Select which year was this server is created for. The features enabled in the server will be limited to this year.");
    replaceMessage("NOTIFICATION_TITLE_DISCORD", null, "Oldcord");

    //Custom flags patch
    if (!release_date.endsWith("_2015")) {
        script = script.replace(/("\.\/sydney\.png".*?e\.exports=)\w/, "$1(f)=>`${window.cdn_url}/assets/flags/${f.substring(2)}`");
    }

    //Remove useless unknown-field error
    if (kind == "root")
        script = script.replace("if(!this.has(e))throw new Error('", "if(!this.has(e))return noop('");

    
    if (window.DiscordNative) {
        //Polyfilling Desktop Native API on <April 2018  (Not entirely complete!)
        if (release_date.endsWith("_2015") || release_date.endsWith("_2016") || release_date.endsWith("_2017") || (release_date.endsWith("_2018") && (release_date.startsWith("january") || release_date.startsWith("february") || release_date.startsWith("march")))) {
            script = script.replace(/\/\^win\/\.test\(this\.platform\)/, "/^win/.test(window.DiscordNative.process.platform)");
            script = script.replace(/"darwin"===this.platform/, `"darwin"===window.DiscordNative.process.platform`);
            script = script.replace(/"linux"===this.platform/, `"linux"===window.DiscordNative.process.platform`);
            script = script.replaceAll(/(\w)=\w\?\w.remote.require\(".\/Utils"\):null/g, `$1=window.DiscordNative?window.DiscordNative.nativeModules.requireModule("discord_utils"):null`);
            script = script.replaceAll(/return (\w)\?(\w).remote\[(\w)\]:(\w)\[(\w)\]/g, ""); // Stubbing
            script = script.replaceAll(/this\.require\(".\/VoiceEngine",!0\)/g, `window.DiscordNative.nativeModules.requireModule("discord_voice")`);
            script = script.replace(/(\w)\.isMaximized\(\)\?\w\.unmaximize\(\):\w\.maximize\(\)/, `$1.maximize()`);
            script = script.replace(/window.__require\?"Discord Client"/, `window.DiscordNative?"Discord Client"`)
            script = script.replaceAll(/\w\.remote\.getCurrentWindow\(\)/g, `window.DiscordNative.window`);
            script = script.replaceAll(/\w\.remote\.require\((\w)\)/g, "window.DiscordNative.nativeModules.requireModule($1)");
        }

        // Polyfill botches for specific builds
        if (release_date.endsWith("_2016") || (release_date.startsWith("january") && release_date.endsWith("_2017"))) {
            script = script.replace(/\w\.setObservedGamesCallback/, `window.DiscordNative.nativeModules.requireModule("discord_utils").setObservedGamesCallback`);
            script = script.replaceAll(/var (\w+)=\w\["default"\]\.requireElectron\("powerMonitor",!0\);/g, `var $1=window.DiscordNative.powerMonitor;`);
            script = script.replace(/var \w=\w\["default"\]\._getCurrentWindow\(\)\.webContents;\w\.removeAllListeners\("devtools-opened"\),\w\.on\("devtools-opened",function\(\){return\(0,\w\.consoleWarning\)\(\w\["default"\]\.Messages\)}\)/, "");
        }
        if ((release_date.endsWith("_2017") && !release_date.startsWith("january")) || (release_date.endsWith("_2018") && (release_date.startsWith("january") || release_date.startsWith("february") || release_date.startsWith("march")))) {
            script = script.replaceAll(/this\.getDiscordUtils\(\)/g, `window.DiscordNative.nativeModules.requireModule("discord_utils")`);
            script = script.replaceAll(/\w\.default\.requireElectron\("powerMonitor",!0\)/g, `window.DiscordNative.powerMonitor`);
            script = script.replaceAll(/this\.requireElectron\("powerMonitor",!0\)/g, `window.DiscordNative.powerMonitor`);
            script = script.replace(/var \w=\w\.default\._getCurrentWindow\(\)\.webContents;\w\.removeAllListeners\("devtools-opened"\),\w\.on\("devtools-opened",function\(\){return\(0,\w\.consoleWarning\)\(\w\.default\.Messages\)}\)/, "");
        }

        //Desktop Native API fix for 2018+ (Not entirely complete!)
        if (release_date.endsWith("_2018")) {
            script = script.replace(/(\w)\.globals\.releaseChannel/, "$1.app.getReleaseChannel()")
            script = script.replace(/(\w)\.globals\.features/, "$1.features")
            script = script.replace(/(\w)\.globals\[(\w)\]/, "$1[$2]")
            script = script.replace(/return \w\.removeAllListeners\("devtools-opened"\),\w\.on\("devtools-opened",function\(\){\w\.emit\("devtools-opened"\)}\),\w/, "");
            script = script.replace(/var \w=\w\.default\.window\.webContents;\w\.removeAllListeners\("devtools-opened"\),\w\.on\("devtools-opened",function\(\){return\(0,\w\.consoleWarning\)\(\w\.default\.Messages\)}\)/, "");
            script = script.replace(/return \w\.default\.ensureModule\("discord_spellcheck"\)\.then\(function\(\){var \w=\w.default.requireModule\("discord_spellcheck"\)\.Spellchecker,\w=new \w\(new \w\);return function\(\w\){null!=document\.body&&document\.body\.addEventListener\("input",function\(\w\){null!=\w\.target&&"string"==typeof \w\.target.value&&e.detectLocale\(\w\.target\.value\)},!0\)}\(\w\),\w}\)/, "")
        }
    }

    //Electron compatibility (Universal)
    script = script.replaceAll(/"discord:\/\/"/g, `"oldcord://"`);

    if (release_date.endsWith("_2019")) {
        //Lazily fix 2019. We don't implement user affinities.
        script = script.replaceAll("f.default.getUserAffinitiesUserIds().has(t.id)", "false");
        script = script.replaceAll(/\w\.userAffinties/g, "[]");
    }
    
    //Remove VIDEO_PROVIDER_CHECK_UNIX_TIMESTAMP hack
    script = script.replace("1492472454139", "0");

    return script;
}

function patchCSS(css) {
    css = css.replaceAll(/d3dsisomax34re.cloudfront.net/g, location.host);
    
    css = css.replaceAll(/url\(\/assets\//g, `url(${cdn_url}/assets/`);

    return css;
}

async function timer(ms) {
    return new Promise(res => setTimeout(res, ms));
}

(async function() {
    loadLog("Build: " + release_date);
    
    loadLog("Loading bootloader parameters");
    try {
        config = await (await fetch("/bootloaderConfig")).json();
    } catch (e) {
        loadLog("Fatal error occurred. Please check the console.", true, true);
        throw e;
    }
    
    document.title = config.instance_name;

    if (window.DiscordNative && release_date == "april_1_2018") {
        loadLog("This build does not work on desktop client due to missing important scripts.", true, true)
        loadLog(`Redirecting back to the selector in 3 seconds...`, false, true)
        await timer(3000);
        window.location.replace("/selector");
        return
    }

    const brokenLogin = [ "november_16_2017", "december_21_2017", "january_27_2018", "march_7_2018", "april_1_2018", "april_23_2018" ].includes(release_date);
    const noCaptchaSupport = release_date.endsWith("_2015") || release_date.endsWith("_2016");
    if ((noCaptchaSupport || brokenLogin) && localStorage && !localStorage.getItem("token")) {
        if (noCaptchaSupport)
            loadLog("Warning: You aren't logged in, and this build does not support the captcha required for registration. Switching to February 25 2018 temporarily.", true, true);
        
        if (brokenLogin)
            loadLog("Warning: You aren't logged in, and the login page is BROKEN on this build. Switching to February 25 2018 temporarily.", true, true);
        
        release_date = "february_25_2018";
        
        //Wait until the user has logged in, then refresh
        let waitForLogin = setInterval(() => {
            if (window.localStorage && window.localStorage.getItem("token")) {
                clearInterval(waitForLogin);
                location.reload();
            }
        }, 1000);
    }
    
    //Disables certain types of logging
    window.BetterDiscord = true;
    
    if (!window.Firebug) {
        window.Firebug = {
            chrome: {
                isInitialized: false
            }
        };
    }
    
    window.GLOBAL_ENV = {
        "API_ENDPOINT": "//" + location.host + "/api",
        "API_VERSION": 6,
        "GATEWAY_ENDPOINT": config.gateway,
        "WEBAPP_ENDPOINT": cdn_url,
        "CDN_HOST": "//" + location.host,
        "ASSET_ENDPOINT": cdn_url,
        "MEDIA_PROXY_ENDPOINT": "//" + location.host,
        "WIDGET_ENDPOINT": "",
        "INVITE_HOST": config.custom_invite_url,
        "GUILD_TEMPLATE_HOST": location.host,
        "GIFT_CODE_HOST": location.host,
        "RELEASE_CHANNEL": "staging",
        "MARKETING_ENDPOINT": "",
        "BRAINTREE_KEY": "",
        "STRIPE_KEY": "",
        "NETWORKING_ENDPOINT": "",
        "RTC_LATENCY_ENDPOINT": "",
        "ACTIVITY_APPLICATION_HOST": "",
        "PROJECT_ENV": "development",
        "REMOTE_AUTH_ENDPOINT": "",
        "SENTRY_TAGS": {
            "buildId": "0",
            "buildType": "CLIENT_MOD_PLEASE_IGNORE"
        },
        "MIGRATION_SOURCE_ORIGIN": "",
        "MIGRATION_DESTINATION_ORIGIN": "",
        "HTML_TIMESTAMP": 1724751950316,
        "ALGOLIA_KEY": ""
    };

    loadLog("Downloading application");
    let html;
    try {
        if (location.href.includes('/developers')) {
            let dev_year = release_date.split('_')[2];

            if (isNaN(parseInt(dev_year)) || (parseInt(dev_year) <= 2017 || parseInt(dev_year) > 2019)) {
                dev_year = "2018";
            }

            html = await (await fetch(`${cdn_url}/assets/clients/developers_${dev_year}/app.html`)).text();
        } else html = await (await fetch(`${cdn_url}/assets/clients/${release_date}/app.html`)).text();
    } catch (e) {
        loadLog("Fatal error occurred. Please check the console.", true, true);
        throw e;
    }

    let head = /<head>([^]*?)<\/head>/.exec(html)[1];
    let body = /<body>([^]*?)<\/body>/.exec(html)[1];
    let scripts = /<script src="([^"]+)".*>/.exec(body);

    async function patchAndExecute(path, kind) {
        if (path.startsWith("http")) {
            path = new URL(path).pathname;
        }
        
        loadLog("Downloading script: " + path);
        let response = await fetch(`${cdn_url}${path}`);
        if (!response.ok) {
            if (response.status == 404)
                loadLog("Script is missing: " + path, true);
            else
                loadLog(`Failed to download script (HTTP ${response.status}): ${path}`, true);
            return;
        }
        
        let script = await response.text();
        
        loadLog(`Executing ${kind} script: ${path}`);
        eval?.(patchJS(script, kind));
    }

    //Copy icon
    let icon = document.getElementById("icon");
    if (icon) {
        let newIcon = head.match(/<link rel="icon" href="([^"]+)"[^>]*>/i);
        if (newIcon && newIcon[1])
            icon.href = newIcon[1];
    }

    //Intercept new scripts so that they can be patched too
    let oldAppendChild = document.head.appendChild.bind(document.head);
    document.head.appendChild = function(elm) {
        if (elm.tagName != "SCRIPT") {
            oldAppendChild(elm);
            return;
        }
        
        patchAndExecute(elm.src, "inline");
    }

    //Copy react roots
    for (let div of body.matchAll(/<div[^>]*>[^]*<\/div>/g)) {
        document.body.innerHTML = div[0] + document.body.innerHTML;
    }

    //Patch and install stylesheets
    for (let styleUrl of head.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)) {
        try {
            loadLog("Downloading stylesheet: " + styleUrl[1]);
            let style = await (await fetch(`${cdn_url}${styleUrl[1]}`)).text();
            
            loadLog("Installing stylesheet: " + styleUrl[1]);
            let elm = document.createElement("style");
            elm.innerText = patchCSS(style);
            document.head.appendChild(elm);
        } catch (e) {
            loadLog("Error occurred. Please check the console.", true, true);
            console.error(e);
        }
    }

    //Patch and execute scripts
    for (let scriptUrl of body.matchAll(/<script src="([^"]+)"[^>]*>/g)) {
        try {
            await patchAndExecute(scriptUrl[1], "root");
        } catch (e) {
            loadLog("Error occurred. Please check the console.", true, true);
            console.error(e);
        }
    }

    //Cleanup
    document.body.style = null;
    let appMount = document.getElementById("app-mount");
    if (appMount) {
        document.getElementById("loadingTxt").remove();
    } else {
        let interval = setInterval(function() {
            if (document.getElementsByClassName("theme-dark").length == 0 && document.getElementsByClassName("guilds").length == 0)
                return;

            document.getElementById("loadingTxt").remove();
            clearInterval(interval);
        }, 100);
    }
})();
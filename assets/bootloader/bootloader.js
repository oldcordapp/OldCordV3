window.__require = window.require;
window.__OVERLAY__ = window.overlay != null;

const cdn_url = "https://cdn.oldcordapp.com";

let config;
function loadLog(text) {
    console.log(text);

    const loadingTxt = document.getElementById("loadingTxt");
    if (!loadingTxt)
        return;

    const elm = document.createElement("div");
    elm.innerText = text;
    loadingTxt.appendChild(elm);
}

function noop() {}

const release_date = (function() {
	const parts = `; ${document.cookie}`.split("; release_date=");
	if (parts.length === 2)
		return parts.pop().split(';').shift();
})();

function patchJS(script) {
    script = script.replace('__[STANDALONE]__', '');
    
    script = script.replaceAll("\"Discord\"", "\"Oldcord\"");
    script = script.replaceAll("'Discord'", "'Oldcord'");
    
    script = script.replaceAll("https://", location.protocol + "//");

    if (release_date.endsWith("2015")) {
        script = script.replaceAll(".presence.", ".presences.");
        script = script.replaceAll(/d3dsisomax34re.cloudfront.net/g, config.base_url);
    }

    script = script.replaceAll(/status.discordapp.com/g, config.base_url);
    script = script.replaceAll(/cdn.discordapp.com/g, config.base_url);
    script = script.replaceAll(/discordcdn.com/g, config.base_url); //??? DISCORDCDN.COM?!!11
    script = script.replaceAll(/discord.gg/g, config.custom_invite_url);
    script = script.replaceAll(/discordapp.com/g, config.base_url);
    if (release_date == "april_1_2018")
        script = script.replaceAll("null!=e&&e.bucket!==f.ExperimentBuckets.CONTROL", "true"); //april fools force enable @someone experiment
    script = script.replaceAll(/isEmojiDisabled:function\([^)]*\){/g, "$&return false;");
    script = script.replaceAll(/=t.invalidEmojis/g, "=[]");
    
    script = script.replaceAll(/e\.exports=n\.p/g, `e.exports="${cdn_url}/assets/"`);

    script = script.replaceAll("if(!this.has(e))throw new Error('", "if(!this.has(e))return noop('");

    if (release_date.endsWith("2016")) {
        script = script.replaceAll("QFusd4xbRKo", "gNEr6tM9Zgc");
    }

    return script;
}

function patchCSS(css) {
    css = css.replaceAll(/d3dsisomax34re.cloudfront.net/g, config.base_url);
    
    css = css.replaceAll(/url\(\/assets\//g, `url(${cdn_url}/assets/`);

    return css;
}

const completedPatches = {};
let patcherLock = 0;
function monkeyPatcher() {
    if (patcherLock != 0)
        return;

    patcherLock++;

    if (patcherLock != 1) {
        patcherLock--;
        setTimeout(monkeyPatcher, 10);
        return;
    }

    if (!window.webpackJsonp)
        return; //Ran too early

    patcherBusy = true;

    window.wpRequire ??= webpackJsonp([], [(module, exports, require) => { module.exports = require; }]);
    window.wpRequire ??= webpackJsonp([], {"monkeypatch": (module, exports, require) => { module.exports = require; }}, [["monkeypatch"]]);
    if (!window.wpRequire) {
        throw "Failed to patch: Couldn't get webpack require()";
    }

    const modules = window.wpRequire.c;
    if (!modules) {
        console.error("Couldn't get webpack modules cache. Some patches may fail.");
    }

    function propsFilter(props, module) {
        return props.every ? props.every((p) => module[p] !== undefined) : module[props] !== undefined;
    }

    //TODO: DRY
    window.findByProps ??= function(props) {
        for (const mod in modules) {
            if (!modules.hasOwnProperty(mod))
                continue;

            const module = modules[mod].exports;

            if (!module)
                continue;

            if (module.default && module.__esModule && propsFilter(props, module.default))
                return module.default;

            if (propsFilter(props, module))
                return module;
        }
    };

    window.findByPropsAll ??= function(props) {
        let foundModules = [];

        for (const mod in modules) {
            if (!modules.hasOwnProperty(mod))
                continue;

            const module = modules[mod].exports;

            if (!module)
                continue;

            if (module.default && module.__esModule && propsFilter(props, module.default))
                foundModules.push(module.default);

            if (propsFilter(props, module))
                foundModules.push(module);
        }

        return foundModules;
    };

    //Patches
    (function() {
        if (completedPatches.disableTelemetry)
            return;
        
        const mod = findByProps("track");
        if (mod && mod.track) {
            console.log("Disabling telemetry");
            completedPatches.disableTelemetry = true;
            mod.track = () => {};
        }
    })();

    (function() {
        const messageModules = findByPropsAll('Messages');
        for (const module of messageModules) {
            const msgs = module.Messages;
            msgs.FORM_LABEL_SERVER_REGION = 'Server Era';
            msgs.REGION_SELECT_HEADER = 'Select a server era';
            msgs.ONBOARDING_GUILD_SETTINGS_SERVER_REGION = 'Server Era';
            msgs.REGION_SELECT_FOOTER = 'Select which year was this server is created for. The features enabled in the server will be limited to this year.';

            msgs.NOTIFICATION_TITLE_DISCORD = 'Oldcord';
        }
    })();

    (function() {
        if (completedPatches.flagsPatch)
            return;
        
        if (release_date.endsWith("_2015")) {
            completedPatches.flagsPatch = true;
            return; //Patch not needed; 2015 builds do not have region flags.
        }
        
        //Known builds
        let modId = {
            "january_22_2016": 1973,
            "february_9_2016": 1870,
            "february_18_2016": 1866,
            "march_4_2016": 1888,
            "march_18_2016": 1975,
            "april_8_2016": 2783,
            "may_5_2016": 2964,
            "may_19_2016": 2959,
            "june_3_2016": 2971,
            "june_23_2016": 2973,
            "july_11_2016": 3087,
            "july_28_2016": 2971,
            "august_24_2016": 3041,
            "september_8_2016": 3325,
            "september_26_2016": 3279,
            "october_13_2016": 3275,
            "november_3_2016": 3281,
            "november_22_2016": 3399,
            "december_22_2016": 3457,
            "january_8_2017": 3456,
            "january_12_2017": 4103,
            "january_25_2017": 4186,
            "january_23_2017": 4191,
            "january_31_2017": 4191,
            "februrary_1_2017": 4191,
            "februrary_21_2017": 4199,
            "februrary_25_2017": 4158,
            "march_14_2017": 1124,
            "march_30_2017": 706,
            "may_3_2017": 670,
            "may_17_2017": 724,
            "july_20_2017": 698,
            "august_17_2017": 700,
            "september_28_2017": 764,
            "october_5_2017": 1270,
            "november_16_2017": 1662,
            "december_21_2017": 1787,
            "december_24_2017": 1787,
            "april_1_2018": 2357,
        }[release_date];

        if (!modId) {
            //Unknown build. Fallback: Search for the module.
            function bruteFindFlagsResolver(min, max) {
                for (let i = max; i >= min; i--) { //Start from end of the range as it tends to be there
                    try {
                        let mod = modules[i];
                        if (mod && mod.id && mod.keys && mod.resolve) {
                            let keys = mod.keys();
                            if (keys && keys.includes('./sydney.png')) {
                                return mod; //Found it
                            }
                        }
                    } catch (e) {
                        //Ignore exceptions. If it breaks, it's not what we're looking for.
                    }
                }
            }

            let result = bruteFindFlagsResolver(1000, 4000);
            if (result)
                modId = result.id;
        }

        if (!modId)
            return; //Failed

        //Apply patch
        console.log("Applying region flag patch");
        completedPatches.flagsPatch = true;
        modules[modId] = {
            exports: (file) => `${cdn_url}/flags/${file.substring(2)}`,
            id: modId,
            loaded: true
        };
    })();

    patcherLock--;
}

(async function() {
    loadLog("Loading bootloader parameters");
    config = await (await fetch("/bootloaderConfig")).json();

    loadLog("Loading application");
    let html = await (await fetch(`${cdn_url}/assets/clients/${release_date}/app.html`)).text();
    let head = /<head>([^]*?)<\/head>/.exec(html)[1];
    let body = /<body>([^]*?)<\/body>/.exec(html)[1];
    let scripts = /<script src="([^"]+)".*>/.exec(body);

    async function patchAndExecute(path) {
        if (path.startsWith("http")) {
            path = new URL(path).pathname;
        }
        
        loadLog("Downloading script " + path);
        let script = await (await fetch(`${cdn_url}${path}`)).text();
        
        loadLog("Executing script " + path);
        eval?.(patchJS(script));
        
        monkeyPatcher();
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
        
        patchAndExecute(elm.src);
    }

    //Copy react roots
    for (let div of body.matchAll(/<div[^>]*><\/div>/g)) {
        document.body.innerHTML += div[0];
    }

    try {
        //Patch and install stylesheets
        for (let styleUrl of head.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)) {
            loadLog("Downloading stylesheet " + styleUrl[1]);
            let style = await (await fetch(`${cdn_url}${styleUrl[1]}`)).text();
            
            loadLog("Installing stylesheet " + styleUrl[1]);
            let elm = document.createElement("style");
            elm.innerText = patchCSS(style);
            document.head.appendChild(elm);
        }

        //Patch and execute scripts
        for (let scriptUrl of body.matchAll(/<script src="([^"]+)"[^>]*>/g)) {
            await patchAndExecute(scriptUrl[1]);
        }
        
        //Run patcher again just to be sure
        setTimeout(monkeyPatcher, 5000);
    } catch (e) {
        loadLog("Error occurred. Check console.");
        throw e;
    }

    //Cleanup
    document.getElementById("loadingTxt").remove();
})();
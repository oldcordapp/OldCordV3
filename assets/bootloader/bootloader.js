window.__require = window.require;
window.__OVERLAY__ = window.overlay != null;

const cdn_url = "https://cdn.oldcordapp.com";

let config;

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
    script = script.replaceAll(/discord.gg/g, config.custom_invite_url);
    script = script.replaceAll(/discordapp.com/g, config.base_url);
    
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

function monkeyPatcher() {
    if (!webpackJsonp)
        throw Error("Monkey patcher ran too early.");

    let wpRequire;
    wpRequire ??= webpackJsonp([10000], [(module, exports, require) => { module.exports = require; wpRequire ??= require; }], [0]);
    const modules = wpRequire.c;
    
    function propsFilter(props, module) {
        return props.every ? props.every((p) => module[p] !== undefined) : module[props] !== undefined;
    }

    //TODO: DRY
    function findByProps(props) {
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
    }

    function findByPropsAll(props) {
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
    }
    
    //Make the supporting funcs available for the benefit of debugging and modders
    window.wpRequire = wpRequire;
    window.findByProps = findByProps;
    window.findByPropsAll = findByPropsAll;

    //Patches
    (function() {
        const mod = findByProps("track");
        if (mod && mod.track) {
            console.log("Disabling telemetry");
            mod.track = () => {};
        }
    })();

    (function() {
        console.log("Applying text patch");
        
        const messageModules = findByPropsAll('Messages');
        for (const module of messageModules) {
            const msgs = module.Messages;
            msgs.FORM_LABEL_SERVER_REGION = 'Server Era';
            msgs.REGION_SELECT_HEADER = 'Select a server era';
            msgs.ONBOARDING_GUILD_SETTINGS_SERVER_REGION = 'Server Era';
            msgs.REGION_SELECT_FOOTER = ''; //TODO: Write a description of what server eras do

            msgs.NOTIFICATION_TITLE_DISCORD = 'Oldcord';
        }
    })();

    (function() {
        if (release_date.endsWith("_2015"))
            return; //Patch not needed; 2015 builds do not have region flags.

        console.log("Applying region flag patch");

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
        }[release_date];

        if (!modId) {
            //Unknown build. Fallback: Search for the module.
            function bruteFindFlagsResolver(min, max) {
                //Use brute force to find the damn thing
                for (let i = max; i > min; i--) { //Start from end of the range as it tends to be there
                    let unload = false;
                    try {
                        let mod = modules[i];
                        if (!mod || !mod.loaded) {
                            //Load unloaded modules, goddammit, tear the whole place up.
                            unload = true;
                            mod = wpRequire(i);
                        }
                        if (mod && mod.id && mod.keys && mod.resolve) {
                            let keys = mod.keys();
                            if (keys && keys.includes('./sydney.png')) {
                                return mod; //Found it
                            }
                        }
                    } catch (e) {
                        //Ignore exceptions. If it breaks, it's not what we're looking for.
                    }
                    if (unload)
                        delete modules[i]; //Unload anything which we had to load
                }
            }

            let result = bruteFindFlagsResolver(1900, 4000);
            if (result)
                modId = result.id;
        }

        if (!modId) {
            //Failed
            console.error("Failed to monkey patch flag lookup; couldn't find the module.");
            return;
        }

        //Apply patch
        modules[modId] = {
            exports: (file) => `${cdn_url}/flags/${file.substring(2)}`,
            id: modId,
            loaded: true
        };
    })();

    (function() {
        let module = findByProps("isEmojiDisabled");
        if (module) {
            console.log("Enabling emojis everywhere");
            module.isEmojiDisabled = () => false;
        }
    })();

    (function() {
        let module = findByProps("_sendMessage");
        if (module) {
            console.log("Fixing \"emoji doesn\'t work here\" error");
            let originalFunc = module._sendMessage.bind(module);
            findByProps("_sendMessage")._sendMessage = (channelId, _ref2) => {
                _ref2.invalidEmojis = [];
                originalFunc(channelId, _ref2);
            }
        }
    })();
}

(async function() {
    console.log("Loading bootloader config");
    config = await (await fetch("/bootloaderConfig")).json();

    console.log("Loading application");
    let html = await (await fetch(`${cdn_url}/assets/clients/${release_date}/app.html`)).text();
    let head = /<head>([^]*?)<\/head>/.exec(html)[1];
    let body = /<body>([^]*?)<\/body>/.exec(html)[1];
    let scripts = /<script src="([^"]+)".*>/.exec(body);
    
    //Copy icon
    let icon = document.getElementById("icon");
    if (icon) {
        let newIcon = head.match(/<link rel="icon" href="([^"]+)"[^>]*>/i);
        if (newIcon[1])
            icon.href = newIcon[1];
    }

    //Copy react roots
    for (let div of body.matchAll(/<div[^>]*><\/div>/g)) {
        document.body.innerHTML += div[0];
    }

    //Patch and install stylesheet
    for (let styleUrl of head.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)) {
        let style = await (await fetch(`${cdn_url}${styleUrl[1]}`)).text();
        
        console.log("Installing stylesheet " + styleUrl[1]);
        let elm = document.createElement("style");
        elm.innerText = patchCSS(style);
        document.head.appendChild(elm);
    }

    //Patch and execute scripts
    for (let scriptUrl of body.matchAll(/<script src="([^"]+)"[^>]*>/g)) {
        let script = await (await fetch(`${cdn_url}${scriptUrl[1]}`)).text();
        console.log("Executing " + scriptUrl[1]);
        eval?.(patchJS(script));
    }
    
    //Apply monkey patches
    monkeyPatcher();
})();
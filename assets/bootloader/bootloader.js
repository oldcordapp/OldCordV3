window.__require = window.require;
window.__OVERLAY__ = window.overlay != null;

window.cdn_url = "https://cdn.oldcordapp.com";

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
    
    script = script.replaceAll(/track:function\([^)]*\){/g, "$&return;");
    script = script.replaceAll(/(function .+\(e\)){.*?post\({.*url:\w\.Endpoints\.TRACK.*?}\)}/g, "$1{}");
    
    function replaceMessage(name, value) {
        script = script.replaceAll(new RegExp(`${name}:".*?"`, "g"), `${name}:"${value}"`);
    }
    replaceMessage("FORM_LABEL_SERVER_REGION", "Server Era");
    replaceMessage("ONBOARDING_GUILD_SETTINGS_SERVER_REGION", "Server Era");
    replaceMessage("REGION_SELECT_HEADER", "Select a server era");
    replaceMessage("REGION_SELECT_FOOTER", "Select which year was this server is created for. The features enabled in the server will be limited to this year.");
    replaceMessage("NOTIFICATION_TITLE_DISCORD", "Oldcord");
    
    if (!release_date.endsWith("_2015")) {
        script = script.replace(/("\.\/sydney\.png".*?e\.exports=)\w/, "$1(f)=>`${window.cdn_url}/assets/flags/${f.substring(2)}`");
    }

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
    } catch (e) {
        loadLog("Error occurred. Check console.");
        throw e;
    }

    //Cleanup
    document.getElementById("loadingTxt").remove();
    document.body.style = null;
})();
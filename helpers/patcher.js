const fs = require('fs');
const { logText } = require('./logger');
const { config } = require('./globalutils');

//Generate monkey patcher
let patchFile = null;
if (config.patcher_location !== "") {
    if (!config.patcher_config) {
        console.error("No patcher_config was provided in the config.");
        process.exit(1);
    }
    
    patchFile = "const patcher_config = ";
    patchFile += JSON.stringify(config.patcher_config);
    patchFile += ";\n";
    patchFile += fs.readFileSync(config.patcher_location, "utf8");
}

//Ensure patch config has all the keys it needs
//TODO: IOU 1 patcher_config field

module.exports = {
    patchFile: patchFile,
    inject: (html) => {
        html = "<!DOCTYPE html>\n" + html;
        if (!patchFile)
            return html;
        else
            return html.replace("</body>", `   <script src="/patch.js"></script>\n   </body>`);
    },
};
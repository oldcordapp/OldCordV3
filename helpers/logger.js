let properties = {
    ignoreDebug: false,
    disabled: false,
};

const logText = (text, type) => {
    if (properties.disabled || (type == 'debug' && properties.ignoreDebug)) {
        return;
    }

    if (type == 'error') {
        let stack = text.stack;
        let functionname = stack.split('\n')[1].trim().split(' ')[1] || '<anonymous>';
        let message = text.toString();

        console.log(`[OLDCORDV3] ERROR @ ${functionname} -> ${message}`);
    } else console.log(`[OLDCORDV3] <${type.toUpperCase()}>: ${text}`);
};

module.exports = { 
    logText 
};
let properties = {
    ignoreDebug: false,
    disabled: false,
    fullErrors: true
};

const logText = (text, type) => {
    if (properties.disabled || (type == 'debug' && properties.ignoreDebug)) {
        return;
    }

    if (type !== 'error') {
        console.log(`[OLDCORDV3] <${type.toUpperCase()}>: ${text}`);
        return;
    }

    if (properties.fullErrors) {
        console.error(text);
        return;
    }

    let stack = text.stack;
    let functionname = stack.split('\n')[1].trim().split(' ')[1] || '<anonymous>';
    let message = text.toString();

    console.error(`[OLDCORDV3] ERROR @ ${functionname} -> ${message}`);
};

module.exports = { 
    logText 
};
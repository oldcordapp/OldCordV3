let properties = {
    ignoreDebug: false,
    disabled: false,
};

const logText = (text, type,) => {
    if (properties.disabled || (type == 'debug' && properties.ignoreDebug)) {
        return;
    }

    console.log(`[OLDCORDV3] <${type.toUpperCase()}>: ${text}`);
};

module.exports = { 
    logText 
};
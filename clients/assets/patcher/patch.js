//patcher_config is inserted here

if (!webpackJsonp)
	throw Error("Monkey patcher ran too early.");

const wpRequire = webpackJsonp([], [(module, exports, require) => { module.exports = require }]);
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

const release_date = (function() {
	const parts = `; ${document.cookie}`.split("; release_date=");
	if (parts.length === 2)
		return parts.pop().split(';').shift();
})();


//Patches
(function() {
	const mod = findByProps("track");
	if (mod && mod.track) {
		console.log("Disabling telemetry");
		mod.track = () => {};
	}
})();

(function() {
	console.log("Applying server region text patch");
	
	const messageModules = findByPropsAll('Messages');
	for (const module of messageModules) {
		const msgs = module.Messages;
		msgs.FORM_LABEL_SERVER_REGION = 'Server Era';
		msgs.REGION_SELECT_HEADER = 'Select a server era';
		msgs.ONBOARDING_GUILD_SETTINGS_SERVER_REGION = 'Server Era';
		msgs.REGION_SELECT_FOOTER = ''; //TODO: Write a description of what server eras do
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
		exports: (file) => wpRequire.p + "flags/" + file.substring(2),
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
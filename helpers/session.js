const globalUtils = require('./globalutils');
const { logText } = require("./logger");
const zlib = require('zlib');

//Adapted from Hummus' handling of sessions & whatnot

const BUFFER_LIMIT = 500; //max dispatch event backlog before terminating?
const SESSION_TIMEOUT = 15 * 1000; //15 seconds brooo

class session {
    constructor(id, socket, user, token, ready, presence) {
        this.id = id;
        this.socket = socket;
        this.token = token;
        this.user = user;
        this.seq = 0;
        this.time = Date.now();
        this.ready = ready;
        this.presence = presence;
        this.dead = false;
        this.lastMessage = Date.now();
        this.ratelimited = false;
        this.messages = 0;
        this.eventsBuffer = [];
        this.guilds = [];
        this.unavailable_guilds = [];
        this.presences = [];
        this.read_states = [];
        this.relationships = [];
        this.subscriptions = [];
    }
    onClose(code) {
        if (this.dead) return;
        
        this.dead = true;
        this.socket = null;

        if (code == 1006 || code == 1001) return this.terminate();

        this.timeout = setTimeout(this.terminate.bind(this), SESSION_TIMEOUT);
    }
    subscribe(subscriptionType, parameters) {
        let valid_subs = [
            "GUILD_MEMBER_LIST_UPDATE"
        ]   

        if (!valid_subs.includes(subscriptionType)) {
            return false; //invalid event subscription type
        }

        if (subscriptionType === "GUILD_MEMBER_LIST_UPDATE") {
            if (this.subscriptions.find(x => x.type === "GUILD_MEMBER_LIST_UPDATE" && x.channel === parameters.channel && x.range === parameters.range)) {
                return false; //already subbed to member update events for this range in the channel
            }

            this.subscriptions.push({
                type: "GUILD_MEMBER_LIST_UPDATE",
                channel: parameters.channel,
                range: parameters.range
            })
        }

        return true;
    }
    async updatePresence(status, game_id = null, save_presence = true) {
        try {
            if (status === this.presence.status) return;

            let valid_status = [
                "online",
                "idle",
                "invisible",
                "offline",
                "dnd"
            ];

            if (!valid_status.includes(status.toLowerCase())) return;

            if (status.toLowerCase() != "offline" && save_presence) {
                this.user.settings.status = status.toLowerCase();

                await global.database.updateSettings(this.user.id, this.user.settings);

                await this.dispatch("USER_SETTINGS_UPDATE", this.user.settings);

                //prevent users from saving offline as their last seen status... as u cant do that
            }

            this.presence.status = status.toLowerCase();
            this.presence.game_id = game_id;
            
            await this.dispatchPresenceUpdate();
        } catch(error) { 
            logText(error, "error");
        }
    }
    async dispatch(type, payload) {
        if (!this.ready) return;
        if (this.dead) return;

        let sequence = ++this.seq;

        if (this.eventsBuffer.length > BUFFER_LIMIT) {
            if (this.dead) return this.terminate();

            this.eventsBuffer.shift();
            this.eventsBuffer.push({
                type: type,
                payload: payload,
                seq: sequence
            });
        } else {
            this.eventsBuffer.push({
                type: type,
                payload: payload,
                seq: sequence
            })
        }

        //Evaluate dynamic payload
        if ((typeof payload) == "function") {
            payload = await payload.call(this);
        }

        if (payload) {
            this.send({
                op: 0,
                t: type,
                s: sequence,
                d: payload
            });
        }
    }
    async dispatchPresenceUpdate() {
        let current_guilds = await global.database.getUsersGuilds(this.user.id);

        if (this.guilds !== current_guilds) {
            this.guilds = current_guilds; //track
        }

        if (current_guilds.length == 0) {
            this.presence.guild_id = null;

            await this.dispatch("PRESENCE_UPDATE", this.presence);

            return;
        }

        for(let i = 0; i < current_guilds.length; i++) {
            let guild = current_guilds[i];

            if (!guild) continue;

            if (guild.members.length == 0 || !guild.members) continue;

            this.presence.guild_id = guild.id;

            if (globalUtils.serverRegionToYear(guild.region) == 2015) {
                if (this.presence.status == "dnd") this.presence.status = "online";
                else if (this.presence.status == "invisible") this.presence.status = "offline"; 
            }
            
            let _presence = this.presence;
            await global.dispatcher.dispatchEventInGuild(guild, "PRESENCE_UPDATE", function() {
                globalUtils.personalizePresenceObject(this.socket, _presence);
            });
        }
    }
    async dispatchSelfUpdate() {
        let current_guilds = await global.database.getUsersGuilds(this.user.id);

        if (this.guilds !== current_guilds) {
            this.guilds = current_guilds; //track
        }

        if (current_guilds.length == 0) return;

        for(let i = 0; i < current_guilds.length; i++) {
            let guild = current_guilds[i];

            if (!guild) continue;

            if (guild.members.length == 0 || !guild.members) continue;

            let our_member = guild.members.find(x => x.id === this.user.id);

            if (!our_member) continue;

            await global.dispatcher.dispatchEventInGuild(guild, "GUILD_MEMBER_UPDATE", {
                roles: our_member.roles,
                user: globalUtils.miniUserObject(our_member.user),
                guild_id: guild.id
            });

            await global.dispatcher.dispatchEventInGuild(guild, "USER_UPDATE", our_member);
        }
    }
    async terminate(code = 1006) {
        if (!this.dead) {
            if (code == 1006) {
                this.socket.send(JSON.stringify({
                    op: 7
                }));

                setTimeout(() => {
                    this.socket.close(code);
                }, 10 * 1000);
            }
        }

        this.dead = true;

        if (this.timeout) clearTimeout(this.timeout);

        let uSessions = global.userSessions.get(this.user.id);

		if (uSessions) {
			uSessions.splice(uSessions.indexOf(this), 1);

			if (uSessions.length >= 1) {
				global.userSessions.set(this.user.id, uSessions);
			} else {
				global.userSessions.delete(this.user.id);
			}
		}

        global.sessions.delete(this.id);

        if (uSessions.length == 0) {
            this.updatePresence("offline", null);
        } else await this.updatePresence(uSessions[uSessions.length - 1].presence.status, uSessions[uSessions.length - 1].presence.game_id);
    }
    send(payload) {
        if (this.dead) return;
        if (this.ratelimited) return;

        if (this.socket.wantsZlib) {
            //Closely resembles Discord's zlib implementation from https://gist.github.com/devsnek/4e094812a4798d8f10428d04ee02cab7
            let stringifiedpayload = JSON.stringify(payload);

            let buffer;

            buffer = zlib.deflateSync(stringifiedpayload, {chunkSize: 65535, flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH, level: zlib.constants.Z_BEST_COMPRESSION})

            if (!this.socket.zlibHeader) {
                buffer = buffer.subarray(2, buffer.length);
            }
            else this.socket.zlibHeader = false;
            
            this.socket.send(buffer);
        } else this.socket.send(JSON.stringify(payload));

        this.lastMessage = Date.now();
    }
    start() {
        global.sessions.set(this.id, this);

        let uSessions = global.userSessions.get(this.user.id);

        if (!uSessions) {
            uSessions = [];
        }

        uSessions.push(this);

        global.userSessions.set(this.user.id, uSessions);
    }
    async readyUp(body) {
        this.send({
            op: 0,
            s: ++this.seq,
            t: "READY",
            d: body
        });

        this.ready = true;
    }
    async resume(seq, socket) {
        if (this.timeout) clearTimeout(this.timeout);

        this.socket = socket;
        this.dead = false;

        let items = this.eventsBuffer.filter(s => s.seq > seq);

		for (var k of items) {
			this.dispatch(k.type, k.payload);
		}

        this.dispatch("RESUMED", {
            _trace: ["oldcord-v3"]
        });

        this.updatePresence("online", null, false);
    }
    async prepareReady() {
        try {
            let month = this.socket.client_build_date.getMonth();
            let year = this.socket.client_build_date.getFullYear();

            this.guilds = await global.database.getUsersGuilds(this.user.id);

            for(var guild of this.guilds) {
                if (guild.unavailable) {
                    this.guilds = this.guilds.filter(x => x.id !== guild.id);

                    this.unavailable_guilds.push(guild.id);

                    continue;
                }
                
                if (globalUtils.unavailableGuildsStore.includes(guild.id)) {
                    this.guilds = this.guilds.filter(x => x.id !== guild.id);

                    this.unavailable_guilds.push(guild.id);

                    continue;
                }

                if (guild.region != "everything" && year < parseInt(guild.region)) {
                    this.guilds = this.guilds.filter(x => x.id !== guild.id);

                    continue;
                }

                let guild_presences = guild.presences;

                if (guild_presences.length == 0) continue;

                for(var presence of guild_presences) {
                    this.presences.push({
                        game_id: null,
                        user: globalUtils.miniUserObject(presence.user),
                        activities: [],
                        status: presence.status
                    });
                }

                for(var channel of guild.channels) {
                    if (!this.socket.channel_types_are_ints) {
                        channel.type = channel.type == 2 ? "voice" : "text";
                    }

                    let can_see = await global.permissions.hasChannelPermissionTo(channel, guild, this.user.id, "READ_MESSAGE_HISTORY");

                    if (!can_see) {
                        guild.channels = guild.channels.filter(x => x.id !== channel.id);

                        continue;
                    }

                    let getLatestAcknowledgement = await global.database.getLatestAcknowledgement(this.user.id, channel.id);

                    if (getLatestAcknowledgement) {
                        this.read_states.push(getLatestAcknowledgement);
                    }
                }
            }

            let tutorial = {
                indicators_suppressed: true,
                indicators_confirmed: [
                    "direct-messages",
                    "voice-conversations",
                    "organize-by-topic",
                    "writing-messages",
                    "instant-invite",
                    "server-settings",
                    "create-more-servers",
                    "friends-list",
                    "whos-online",
                    "create-first-server"
                ]
            }

            let chans = await database.getPrivateChannels(this.user.id);
            let filteredDMs = [];
            
            for (var chan_id of chans) {
                let chan = await database.getChannelById(chan_id);
                if (!chan)
                    continue;
                
                chan = globalUtils.personalizeChannelObject(this.socket, chan);
                if (!chan)
                    continue;
                
                filteredDMs.push(chan);
            }
            
            let connectedAccounts = await global.database.getConnectedAccounts(this.user.id);
            let guildSettings = await global.database.getUsersGuildSettings(this.user.id);
            
            this.relationships = this.user.relationships;

            this.readyUp({
                guilds: this.guilds ?? [],
                presences: this.presences ?? [],
                private_channels: filteredDMs,
                relationships: this.relationships ?? [],
                read_state: this.read_states ?? [],
                tutorial: tutorial,
                user: {
                    id: this.user.id,
                    username: this.user.username,
                    avatar: this.user.avatar,
                    email: this.user.email,
                    discriminator: this.user.discriminator,
                    verified: this.user.verified,
                    bot: this.user.bot,
                    premium: this.user.premium
                },
                user_settings: this.user.settings,
                session_id: this.id,
                friend_suggestion_count: 0,
                notes: [],
                analytics_token: globalUtils.generateString(20),
                experiments: (month == 3 && year == 2018) ? ["2018-4_april-fools"] : [], //for 2018 clients
                connected_accounts: connectedAccounts ?? [],
                guild_experiments: [],
                user_guild_settings: guildSettings ?? [],
                heartbeat_interval: 45 * 1000,
                _trace: ["oldcord-v3"]
            });

            for(var guild of this.unavailable_guilds) {
                await this.dispatch("GUILD_DELETE", {
                    id: guild.id,
                    unavailable: true,
                })
            }
        } catch(error) { 
            logText(error, "error");
        }
    }
}

module.exports = session;

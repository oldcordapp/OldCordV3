const globalUtils = require('./globalutils');
const { logText } = require("./logger");
//Adapted from Hummus' handling of sessions & whatnot

const BUFFER_LIMIT = 500; //max dispatch event backlog before terminating?
const SESSION_TIMEOUT = 60 * 2 * 1000; //2 mins

function nineteeneightyfour(socket, type, payload) {
    if (type == "CHANNEL_CREATE" || type == "CHANNEL_UPDATE") {

        if (socket.channel_types_are_ints) {
            if (typeof payload.type == 'string') {
                payload.type = payload.type == "voice" ? 2 : 0;
            }
        } else if (socket.client_build.endsWith("2015")) {
            if (typeof payload.type == 'number') {
                payload.type = payload.type == 2 ? "voice" : "text"
            }
        }
    }

    return payload;
}

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
        this.dm_list = [];
        this.relationships = [];
    }
    onClose(code) {
        if (this.dead) return;
        
        this.dead = true;
        this.socket = null;

        if (code == 1006 || code == 1001) return this.terminate();

        this.timeout = setTimeout(this.terminate.bind(this), SESSION_TIMEOUT);
    }
    async updatePresence(status, game_id = null) {
        try {
            if (status == this.presence.status) return;

            let valid_status = [
                "online",
                "idle",
                "invisible",
                "offline",
                "dnd"
            ];

            if (!valid_status.includes(status.toLowerCase())) return;

            if (status.toLowerCase() != "offline") {
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
    dispatch(type, payload) {
        if (!this.ready) return;
        if (this.dead) return;

        if (this.eventsBuffer.length > BUFFER_LIMIT) {
            if (this.dead) return this.terminate();

            this.eventsBuffer.shift();
            this.eventsBuffer.push({
                type: type,
                payload: payload,
                seq: this.seq
            });
        } else {
            this.eventsBuffer.push({
                type: type,
                payload: payload,
                seq: this.seq
            })
        }

        payload = nineteeneightyfour(this.socket, type, payload);

        this.send({
            op: 0,
            t: type,
            s: ++this.seq,
            d: payload
        });
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

            await global.dispatcher.dispatchEventInGuild(guild.id, "PRESENCE_UPDATE", this.presence);
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

            let our_member = await global.database.getGuildMemberById(guild.id, this.user.id);

            if (!our_member) continue;

            await global.dispatcher.dispatchEventInGuild(guild.id, "GUILD_MEMBER_UPDATE", {
                roles: our_member.roles,
                user: our_member.user,
                guild_id: guild.id
            });

            await global.dispatcher.dispatchEventInGuild(guild.id, "USER_UPDATE", our_member);
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

        this.socket.send(JSON.stringify(payload));

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

        let items = this.eventsBuffer.filter(s => s.seq > seq);

		for (var k of items) {
			this.dispatch(k.type, k.payload);
		}

        this.dispatch("RESUMED", {
            __trace: ['oldcordv3']
        });
    }
    async prepareReady() {
        try {
            let month = this.socket.client_build_date.getMonth();
            let year = this.socket.client_build_date.getFullYear();

            this.guilds = await global.database.getUsersGuilds(this.user.id);

            for(var guild of this.guilds) {
                let guild_presences = await global.database.getGuildPresences(guild.id);

                if (guild_presences.length == 0) continue;

                for(var presence of guild_presences) {
                    this.presences.push({
                        guild_id: guild.id,
                        game_id: null,
                        user: {
                            avatar: presence.user.avatar,
                            discriminator: presence.user.discriminator,
                            id: presence.user.id,
                            username: presence.user.username
                        },
                        status: presence.status
                    })
                }

                for(var channel of guild.channels) {
                    if (!globalUtils.requiresIntsForChannelTypes(this.socket.client_build)) {
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

            let tutorial = await global.database.getTutorial(this.user.id);

            if (tutorial == null) {
                tutorial = {
                    indicators_suppressed: false,
                    indicators_confirmed: []
                }
            }

            let dms = await global.database.getDMChannels(this.user.id);
            
            for (var dm of dms) {
                let closed = await global.database.isDMClosed(dm.id);

                if (closed) {
                    dms = dms.filter(x => x.id !== dm.id);

                    continue;
                }

                let correct_id = dm.author_of_channel_id == this.user.id ? dm.receiver_of_channel_id : dm.author_of_channel_id;
                let user2 = await global.database.getAccountByUserId(correct_id);

                if (user2 == null) {
                    continue;
                }

                let dmChannelObj = {
                    id: dm.id,
                    type: globalUtils.requiresIntsForChannelTypes(this.socket.client_build) ? 1 : "text",
                    recipient: globalUtils.miniUserObject(user2),
                    guild_id: null,
                    is_private: true,
                    last_message_id: dm.last_message_id
                }

                if ((month >= 6 && year == 2016) || year >= 2017) {
                    dmChannelObj.recipients = [
                        dmChannelObj.recipient
                    ];

                    delete dmChannelObj.recipient;
                    delete dmChannelObj.is_private;
                }

                this.dm_list.push(dmChannelObj);
            }

            let connectedAccounts = await global.database.getConnectedAccounts(this.user.id);
            let guildSettings = await global.database.getUsersGuildSettings(this.user.id);

            this.readyUp({
                guilds: this.guilds ?? [],
                presences: this.presences ?? [],
                private_channels: this.dm_list ?? [],
                relationships: this.relationships,
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
                },
                user_settings: this.user.settings,
                session_id: this.id,
                unavailable_guilds: this.unavailable_guilds,
                friend_suggestion_count: 0,
                notes: [],
                analytics_token: globalUtils.generateString(20),
                experiments: [],
                connected_accounts: connectedAccounts ?? [],
                guild_experiments: [],
                user_guild_settings: guildSettings ?? [],
                heartbeat_interval: 45 * 1000,
                _trace: ["oldcord-v3"]
            });
        } catch(error) { 
            logText(error, "error");
        }
    }
}

module.exports = session;

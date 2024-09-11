const { logText } = require('./helpers/logger');
const globalUtils = require('./helpers/globalutils');
const WebSocket = require('ws').WebSocket;
const session = require('./helpers/session');
const zlib = require('zlib');
const Snowflake = require('./helpers/snowflake');

async function syncPresence(socket, packet) {
    let allSessions = global.userSessions.get(socket.user.id);

    if (!allSessions || allSessions.size === 0) return;

    let setStatusTo = "online";
    let gameField = null;

    if (socket.client_build.includes("2015")) {
        gameField = packet.d.game_id || null;

        if (packet.d.idle_since != null) {
            setStatusTo = "idle";
        }
    } else {
        gameField = packet.d.game || null;

        if (packet.d.status) {
            setStatusTo = packet.d.status.toLowerCase();
        }
        
        if (packet.d.afk) {
            setStatusTo = "idle";
        } else if (packet.d.afk === false && packet.d.since === 0 && packet.d.status === "idle") {
            setStatusTo = "online";
        }
    }

    // Sync
    for (let session of allSessions) {
        if (session.id !== socket.session.id) {
            session.presence.status = setStatusTo;
            session.presence.game_id = gameField;
        } //only do this for other sessions, not us as we're gonna update in a sec
    }

    await socket.session.updatePresence(setStatusTo, gameField);
}

const gateway = {
    server: null,
    port: null,
    handleEvents: function () {
        const server = gateway.server;
        
        server.on("listening", () => {
            logText("Listening for connections", "GATEWAY");
        });

        server.on("connection", (socket, req) => {
            const cookies = req.headers.cookie;

            if (!cookies) {
                socket.close(4000, 'Cookies are required to use the Oldcord gateway.');

                return;
            }

            const cookieStore = cookies.split(';').reduce((acc, cookie) => {
                const [key, value] = cookie.split('=').map(v => v.trim());
                acc[key] = value;
                return acc;
            }, {});
            
            if (!cookieStore['release_date']) {
                socket.close(1000, 'The release_date cookie is required to establish a connection to the Oldcord gateway.');

                return;
            }
            
            if (!globalUtils.addClientCapabilities(cookieStore['release_date'], socket)) {
                socket.close(1000, 'The release_date cookie is in an invalid format.');

                return;
            }

            if (req.url.includes("compress=zlib-stream")) {
                socket.wantsZlib = true;
                socket.zlibHeader = true;
            }

            let identified = false;
            let resumed = false;

            socket.cookieStore = cookieStore;

            socket.on('close', async (code) => {
                if (socket.session) {
                    socket.session.onClose(code);
                }
            });

            let heartbeat_payload = JSON.stringify({
                op: 10,
                s: null,
                d: {
                    heartbeat_interval: 45 * 1000,
                    _trace: ["oldcord-v3"]
                }
            });

            if (socket.wantsZlib) {
                let buffer;

                buffer = zlib.deflateSync(heartbeat_payload, {chunkSize: 65535, flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH, level: zlib.constants.Z_BEST_COMPRESSION})
    
                if (!socket.zlibHeader) {
                    buffer = buffer.subarray(2, buffer.length);
                }
                else socket.zlibHeader = false;

                socket.send(buffer);
            } else socket.send(heartbeat_payload);

            socket.hb = {
                timeout: setTimeout(async () => {
                    if (socket.session) await socket.session.updatePresence("offline", null);

                    socket.close(4009, 'Session timed out');
                }, (45 * 1000) + (20 * 1000)),
                reset: () => {
                    if (socket.hb.timeout != null) {
                        clearInterval(socket.hb.timeout);
                    }

                    socket.hb.timeout = new setTimeout(async () => {
                        if (socket.session) await socket.session.updatePresence("offline", null);

                        socket.close(4009, 'Session timed out');
                    }, (45 * 1000) + 20 * 1000);
                },
                acknowledge: (d) => {
                    socket.session.send({
                        op: 11,
                        d: d
                    });
                }
            };

            socket.on('message', async (data) => {
                try {
                    const msg = data.toString("utf-8");
                    const packet = JSON.parse(msg);

                    if (packet.op !== 1) {
                        logText(`Incoming -> ${msg}`, "GATEWAY");
                    } //ignore heartbeat stuff

                    if (packet.op == 2) {
                        if (identified || socket.session) {
                            return socket.close(4005, 'You have already identified.');
                        }

                        logText("New client connection", "GATEWAY");

                        identified = true;

                        let user = await global.database.getAccountByToken(packet.d.token);

                        if (user == null || user.disabled_until) {
                            return socket.close(4004, "Authentication failed");
                        }

                        if (user.bot) {
                            user.settings = {
                                status: "online"
                            }
                        }

                        socket.user = user;

                        let sesh = new session(globalUtils.generateString(16), socket, user, packet.d.token, false, {
                            game_id: null,
                            status: "offline",
                            activities: [],
                            user: globalUtils.miniUserObject(socket.user)
                        });

                        socket.session = sesh;        

                        socket.session.start();

                        await socket.session.prepareReady();

                        let pastPresence = packet.d.presence;

                        if (!pastPresence) {
                            pastPresence = {
                                status: socket.user.settings.status ?? "online",
                                since: 0,
                                afk: false,
                                game: null
                            }
                        }

                        let setStatusTo = pastPresence.status;

                        if (setStatusTo && setStatusTo.status === 'idle' && setStatusTo.since === 0 && !setStatusTo.afk) {
                            setStatusTo = 'online';
                        }

                        await socket.session.updatePresence(setStatusTo, null);
                    } else if (packet.op == 1) {
                        if (!socket.hb) return;

                        socket.hb.acknowledge(packet.d);
                        socket.hb.reset();
                    } else if (packet.op == 3) {
                        if (!socket.session) return socket.close(4003, 'Not authenticated');

                        await syncPresence(socket, packet);
                    } else if (packet.op == 4) {
                        if (!socket.session) return socket.close(4003, 'Not authenticated');

                        let guild_id = packet.d.guild_id;
                        let channel_id = packet.d.channel_id;
                        let self_mute = packet.d.self_mute;
                        let self_deaf = packet.d.self_deaf;

                        socket.session.dispatch("VOICE_STATE_UPDATE", {
                            channel_id: channel_id,
                            user_id: socket.user.id,
                            session_id: globalUtils.generateString(30),
                            deaf: false,
                            mute: false,
                            self_deaf: self_deaf,
                            self_mute: self_mute,
                            suppress: false
                        });

                        socket.session.dispatch("VOICE_SERVER_UPDATE", {
                            token: globalUtils.generateString(30),
                            guild_id: guild_id,
                            endpoint: "ws://" + global.config.signaling_server_url
                        });
                    } else if (packet.op == 12) {
                        if (!socket.session) return;

                        let guild_ids = packet.d;

                        if (guild_ids.length === 0) return;

                        let usersGuilds = socket.session.guilds;

                        if (usersGuilds.length === 0) return;

                        for(var guild of guild_ids) {
                            let guildObj = usersGuilds.find(x => x.id === guild);

                            if (!guildObj) continue;

                            let op12 = await global.database.op12getGuildMembersAndPresences(guildObj);

                            if (op12 == null) continue;

                            socket.session.dispatch("GUILD_SYNC", {
                                id: guildObj.id,
                                presences: op12.presences,
                                members: op12.members
                            });
                        }
                        //op12getGuildMembersAndPresences
                    } else if (packet.op == 14) {
                        //UGHHHHHHHHHHHHHHHHHHHHHHHHHHH
                        if (!socket.session) return;

                        let guild_id = packet.d.guild_id;

                        if (!guild_id); // need to be more strict on this

                        let usersGuilds = socket.session.guilds;

                        let guild = usersGuilds.find(x => x.id === guild_id);

                        if (!guild);

                        let typing = packet.d.typing; //Subscribe to typing events?

                        if (!typing) {
                            packet.d.typing = false;
                        }

                        let activities = packet.d.activities; //subscribe to game updates, etc

                        if (!activities) {
                            packet.d.activities = [];
                        }

                        let members = packet.d.members; //members array to subscribe to ??

                        let channels = packet.d.channels;

                        if (!channels) return;

                        let channelId = Object.keys(packet.d.channels)[0];

                        if (!channelId) return;

                        let range = packet.d.channels[channelId][0];

                        if (!range) return;

                        let [startIndex, endIndex] = range;

                        let channel = guild.channels.find(x => x.id === channelId);

                        if (!channel) return;

                        //to-do subscribe to events for specific members

                        //check for perms to view channel in the payload and do some bullshit math for the list_id

                        let selected_members = guild.members.slice(startIndex, endIndex + 1);

                        let related_presences = [];

                        for(var presence of guild.presences) {
                            let member = selected_members.find(x => x.id === presence.user.id);

                            if (member) {
                                related_presences.push({
                                    presence: presence,
                                    member: member
                                });
                            }
                        }

                        const online = related_presences
                        .filter(p => p.presence.status !== 'offline' && p.presence.status !== 'invisible')
                        .map(p => ({
                            member: {
                                ...p.member,
                                presence: {
                                    status: p.presence.status,
                                    user: {
                                        id: p.member.user.id,
                                    },
                                    game: null,
                                    activities: [],
                                    client_status: null
                                }
                            }
                        }));

                    const offline = related_presences
                        .filter(p => p.presence.status === 'offline' || p.presence.status === 'invisible')
                        .map(p => ({
                            member: {
                                ...p.member,
                                presence: {
                                    status: p.presence.status,
                                    user: {
                                        id: p.member.user.id,
                                    },
                                    game: null,
                                    activities: [],
                                    client_status: null
                                }
                            }
                        }));

                        const items = [
                            { group: { id: 'online', count: online.length } },
                            ...online,
                            { group: { id: 'offline', count: offline.length } },
                            ...offline
                        ];

                        socket.session.dispatch("GUILD_MEMBER_LIST_UPDATE", {
                            guild_id: guild.id,
                            id: 'everyone',
                            ops: [{
                                op: "SYNC",
                                range: range,
                                items: items
                            }],
                            groups: [{
                                count: online.length,
                                id: 'online'
                            }, {
                                count: offline.length,
                                id: 'offline'
                            }],
                        });
                    } else if (packet.op == 6) {
                        let token = packet.d.token;
                        let session_id = packet.d.session_id;

                        if (!token || !session_id) return socket.close(4000, 'Invalid payload');

                        if (socket.session || resumed) return socket.close(4005, 'Cannot resume at this time');

                        resumed = true;

                        let user2 = await global.database.getAccountByToken(token);

                        if (!user2) {
                            return socket.close(4004, 'Authentication failed');
                        }

                        socket.user = user2;

                        let session2 = global.sessions.get(session_id);

                        if (!session2) {
                            let sesh = new session(globalUtils.generateString(16), socket, socket.user, packet.d.token, false, {
                                game_id: null,
                                status: socket.user.settings.status,
                                activities: [],
                                user: globalUtils.miniUserObject(socket.user)
                            });

                            sesh.seq = packet.d.seq;
                            sesh.eventsBuffer = [];
                            sesh.start();

                            socket.session = sesh;
                        }

                        let sesh = null;

                        if (!session2) {
                            sesh = socket.session;
                        } else sesh = session2;

                        if (sesh.user.id !== socket.user.id) {
                            return socket.close(4004, 'Authentication failed');
                        }

                        if (sesh.seq < packet.d.seq) {
                            return socket.close(4007, 'Invalid seq');
                        }

                        if (sesh.eventsBuffer.find(x => x.seq == packet.d.seq)) {
                            socket.session = sesh;

                            return await socket.session.resume(sesh.seq, socket);
                        } else {
                            sesh.send({
                                op: 9,
                                d: false
                            });
                        }
                    }
                }
                catch(error) {
                    logText(error, "error");

                    socket.close(4000, 'Invalid payload');
                }
            });
        });
    },
    ready: function (server) {
        gateway.server = new WebSocket.Server({
            perMessageDeflate: false,
            server: server
        });

        gateway.handleEvents();
    },
};

module.exports = gateway;
const { logText } = require('./helpers/logger');
const globalUtils = require('./helpers/globalutils');
const WebSocket = require('ws').WebSocket;
const zlib = require('zlib');

let dispatcher;

const gateway = {
    server: null,
    port: null,
    clients: [],
    getSocket: function (token) {
        const search = gateway.clients.filter(x => x.token == token);

        return search.length > 0 ? search[0].socket : undefined;
    },
    setDispatcher: function (disp) {
        dispatcher = disp; //fucking javascript
    },
    send: function (socket, data, supportCompression = false) {
        logText(`Outgoing -> ${JSON.stringify(data)}`, "GATEWAY");

        socket.sequence++;

        if (supportCompression) {
            let method = socket.compression;

            if (method == "zlib-stream") {
                let buffer = Buffer.from(JSON.stringify(data));
                let compressed = zlib.deflateSync(buffer);

                socket.send(compressed);
            } else socket.send(JSON.stringify(data));
            
            return;
        }

        socket.send(JSON.stringify(data));
    },
    handleEvents: function () {
        const server = gateway.server;
        
        server.on("listening", () => {
            logText("Listening for connections", "GATEWAY");
        });

        server.on("connection", (socket, req) => {
            const cookies = req.headers.cookie;
            const url = req.url;
            
            let encoding = "";
            let version = "";
            let compression = "";

            if (url.split('=').length > 3) {
                encoding = url.split('=')[1];
                version = url.split('=')[2];
                compression = url.split('=')[3];
            }

            if (compression != "") {
                socket.compression = compression;
            }

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
                socket.close(4000, 'The release_date cookie is required to establish a connection to the Oldcord gateway.');

                return;
            }

            socket.cookieStore = cookieStore;

            socket.on('close', async () => {
                if (!socket.hb) return;

                let client = gateway.clients.find(x => x.socket == socket);

                if (client && client.user) {
                    await dispatcher.dispatchPresenceUpdate(client.user, "offline", null);
                }

                
                gateway.clients = gateway.clients.filter(client => client.socket !== socket);

                if (socket.hb.timeout) {
                    clearTimeout(socket.hb.timeout);
                }
            });

            socket.on('message', async (data) => {
                try {
                    const msg = data.toString("utf-8");
                    const packet = JSON.parse(msg);
                    const cookieStore = socket.cookieStore;
                    const release_date = cookieStore['release_date'];

                    logText(`Incoming -> ${msg}`, "GATEWAY");

                    if (packet.op == 2) {
                        logText("New client connection", "GATEWAY");

                        let user = await globalUtils.database.getAccountByToken(packet.d.token);

                        if (user == null) {
                            return socket.close(4004, "Authentication failed");
                        }

                        socket.user = user;

                        socket.sequence = 0;

                        const existingConnection = gateway.clients.find(x => x.user.id == user.id);

                        if (existingConnection && existingConnection.socket) {
                            //resuming stuff

                            existingConnection.socket.close(4015, 'New connection has been established. This one is no longer needed.');
                            
                            gateway.clients = gateway.clients.filter(client => client.socket !== existingConnection.socket);
                            
                            logText(`Client ${user.id} reconnected -> Continuing on this socket`, "GATEWAY");
                        }

                        socket.session_id = globalUtils.generateString(16);

                        gateway.clients.push({
                            session_id: socket.session_id,
                            token: packet.d.token,
                            socket: socket,
                            user: user,
                            presence: {
                                game: null,
                                status: socket.user.settings.status,
                                user: {
                                    avatar: user.avatar,
                                    discriminator: user.discriminator,
                                    id: user.id,
                                    username: user.username
                                }
                            }
                        });

                        let guilds = await globalUtils.database.getUsersGuilds(user.id);
                        let presences = [];
                        let read_states = [];

                        for(var guild of guilds) {
                            let guild_presences = await globalUtils.database.getGuildPresences(guild.id);

                            if (guild_presences.length == 0) continue;

                            for(var presence of guild_presences) {
                                presences.push({
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
                                if (!globalUtils.requiresIntsForChannelTypes(release_date)) {
                                    channel.type = channel.type == 2 ? "voice" : "text";
                                }

                                let can_see = await globalUtils.permissions.hasChannelPermissionTo(channel, guild, user.id, "READ_MESSAGE_HISTORY");

                                if (!can_see) {
                                    guild.channels = guild.channels.filter(x => x.id !== channel.id);

                                    continue;
                                }

                                let getLatestAcknowledgement = await globalUtils.database.getLatestAcknowledgement(user.id, channel.id);
    
                                if (getLatestAcknowledgement) read_states.push(getLatestAcknowledgement);
                            }
                        }

                        let dms = await globalUtils.database.getDMChannels(user.id);
                        let dm_list = [];

                        for (var dm of dms) {
                            let closed = await globalUtils.database.isDMClosed(dm.id);

                            if (closed) {
                                dms = dms.filter(x => x.id !== dm.id);

                                continue;
                            }

                            let correct_id = dm.author_of_channel_id == user.id ? dm.receiver_of_channel_id : dm.author_of_channel_id;
                            let user2 = await globalUtils.database.getAccountByUserId(correct_id);

                            if (user2 == null) {
                                continue;
                            }

                            dm_list.push({
                                id: dm.id,
                                name: "",
                                topic: "",
                                position: 0,
                                recipient: {
                                    id: user2.id,
                                    username: user2.username,
                                    discriminator: user2.discriminator,
                                    avatar: user2.avatar
                                },
                                type: globalUtils.requiresIntsForChannelTypes(release_date) ? 1 : "text",
                                guild_id: null,
                                is_private: true,
                                permission_overwrites: []
                            });
                        }

                        let tutorial = await globalUtils.database.getTutorial(user.id);

                        if (tutorial == null) {
                            tutorial = {
                                indicators_suppressed: false,
                                indicators_confirmed: []
                            }
                        }

                        socket.hb = {
                            timeout: setTimeout(async () => {
                                await dispatcher.dispatchPresenceUpdate(socket.user.id, "offline", null);

                                socket.close(4009, 'Session timed out');
                            }, (45 * 1000) + (20 * 1000)),
                            reset: () => {
                                if (socket.hb.timeout != null) {
                                    clearInterval(socket.hb.timeout);
                                }

                                socket.hb.timeout = new setTimeout(async () => {
                                    await dispatcher.dispatchPresenceUpdate(socket.user.id, "offline", null);

                                    socket.close(4009, 'Session timed out');
                                }, (45 * 1000) + 20 * 1000);
                            },
                            acknowledge: (d) => {
                                gateway.send(socket, {
                                    op: 11,
                                    d: d
                                }, true);

                                logText(`Acknowledged client heartbeat from ${socket.user.id} (${socket.user.username}#${socket.user.discriminator})`, "GATEWAY");
                            }
                        };

                        let connectedAccounts = await globalUtils.database.getConnectedAccounts(socket.user.id);
                        let guildSettings = await globalUtils.database.getUsersGuildSettings(socket.user.id);

                        gateway.send(socket, {
                            op: 0,
                            s: socket.sequence,
                            t: "READY",
                            d: {
                                guilds: guilds ?? [],
                                presences: presences ?? [],
                                private_channels: dm_list ?? [],
                                relationships: [],
                                read_state: read_states ?? [],
                                tutorial: tutorial,
                                user: user,
                                user_settings: socket.user.settings,
                                session_id: socket.session_id,
                                unavailable_guilds: [],
                                friend_suggestion_count: 0,
                                notes: [],
                                analytics_token: globalUtils.generateString(20),
                                experiments: [],
                                connected_accounts: connectedAccounts ?? [],
                                guild_experiments: [],
                                user_guild_settings: guildSettings ?? [],
                                heartbeat_interval: 45 * 1000,
                                _trace: ["oldcord-v3"]
                            }
                        }, true);

                        gateway.send(socket, {
                            op: 10,
                            s: socket.sequence,
                            d: {
                                heartbeat_interval: 45 * 1000,
                                _trace: ["oldcord-v3"]
                            }
                        }, true);

                        await dispatcher.dispatchPresenceUpdate(user.id, "online", null);
                    } else if (packet.op == 1) {
                        if (!socket.hb) return;

                        socket.hb.acknowledge(packet.d);
                        socket.hb.reset();
                    } else if (packet.op == 3) {
                        if (!socket || !socket.user) return;

                        let client = gateway.clients.find(x => x.socket == socket);

                        if (!client) return;

                        if (socket.cookieStore['release_date'].includes("2015")) {
                            if (packet.d.idle_since == null && packet.d.game_id == null && socket.user.settings.status == 'idle') {
                                await dispatcher.dispatchPresenceUpdate(socket.user.id, "online", null);
    
                                client.presence = {
                                    game: null,
                                    status: 'online',
                                    user: {
                                        avatar: socket.user.avatar,
                                        discriminator: socket.user.discriminator,
                                        id: socket.user.id,
                                        username: socket.user.username
                                    }
                                }
                            } else if (packet.d.idle_since != null && packet.d.status == 'idle') {
                                await dispatcher.dispatchPresenceUpdate(socket.user.id, "idle", null);
                            }
                        } else if (socket.cookieStore['release_date'].includes("2016")) {
                            if (packet.d.since != 0 && packet.d.afk == true) {
                                await dispatcher.dispatchPresenceUpdate(socket.user.id, "idle", null);

                                let pUser = socket.user;

                                client.presence = {
                                    game: null,
                                    status: 'idle',
                                    user: {
                                        avatar: pUser.avatar,
                                        discriminator: pUser.discriminator,
                                        id: pUser.id,
                                        username: pUser.username
                                    }
                                }
                            } else {
                                let accepted_presences = [
                                    "dnd",
                                    "idle",
                                    "online",
                                    "invisible"
                                ];

                                if (!accepted_presences.includes(packet.d.status.toLowerCase())) {
                                    return socket.close(4001, 'Invalid payload');
                                }

                                await dispatcher.dispatchPresenceUpdate(socket.user.id, packet.d.status.toLowerCase(), null);

                                let pUser = socket.user;

                                client.presence = {
                                    game: packet.d.game,
                                    status: packet.d.status.toLowerCase(),
                                    user: {
                                        avatar: pUser.avatar,
                                        discriminator: pUser.discriminator,
                                        id: pUser.id,
                                        username: pUser.username
                                    }
                                }
                            } 
                        }
                    } else if (packet.op == 6) {
                        let token = packet.d.token;
                        let session_id = packet.d.session_id;

                        let client = gateway.clients.find(x => x.session_id == session_id);

                        if (!client) {
                            gateway.send(socket, {
                                op: 9,
                                d: false
                            }, true); //Cannot resume

                            return;
                        }

                        client.socket = socket;

                        let user = await globalUtils.database.getAccountByToken(token);

                        if (user == null) {
                            gateway.send(socket, {
                                op: 9,
                                d: false
                            }, true); //Cannot resume as authentication is invalid

                            return;
                        }

                        client.user = user;

                        socket.user = user;

                        gateway.send(socket, {
                            op: 9,
                            d: true
                        }, true);

                        let queuedEvents = dispatcher.queuedEvents[session_id];

                        if (queuedEvents && queuedEvents.length > 0) {
                            for(var queuedEvent of queuedEvents) {
                                dispatcher.dispatchEventTo(token, queuedEvent.type, queuedEvent.payload);
                            }
                        }
                        
                        dispatcher.queuedEvents[session_id] = [];
                    }
                }
                catch(error) {
                    logText(error, "error");

                    socket.close(4001, 'Invalid payload');
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
    regularReady: function (port) {
        gateway.server = new WebSocket.Server({
            port: port
        });

        gateway.handleEvents();
    }
};

module.exports = gateway;
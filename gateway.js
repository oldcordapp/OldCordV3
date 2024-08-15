const { logText } = require('./helpers/logger');
const globalUtils = require('./helpers/globalutils');
const WebSocket = require('ws').WebSocket;
const session = require('./helpers/session');

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

            let identified = false;
            let resumed = false;

            socket.cookieStore = cookieStore;

            socket.on('close', async (code) => {
                if (socket.session) {
                    socket.session.onClose(code);
                }
            });

            socket.on('message', async (data) => {
                try {
                    const msg = data.toString("utf-8");
                    const packet = JSON.parse(msg);

                    logText(`Incoming -> ${msg}`, "GATEWAY");

                    if (packet.op == 2) {
                        if (identified || socket.session) {
                            return socket.close(4005, 'You have already identified.');
                        }

                        logText("New client connection", "GATEWAY");

                        identified = true;

                        let user = await global.database.getAccountByToken(packet.d.token);

                        if (user == null) {
                            return socket.close(4004, "Authentication failed");
                        }

                        socket.user = user;

                        let sesh = new session(globalUtils.generateString(16), socket, user, packet.d.token, false, {
                            game: null,
                            status: "offline",
                            user: globalUtils.miniUserObject(socket.user)
                        });

                        socket.session = sesh;        

                        socket.hb = {
                            timeout: setTimeout(async () => {
                                await socket.session.updatePresence("offline", null);

                                socket.close(4009, 'Session timed out');
                            }, (45 * 1000) + (20 * 1000)),
                            reset: () => {
                                if (socket.hb.timeout != null) {
                                    clearInterval(socket.hb.timeout);
                                }

                                socket.hb.timeout = new setTimeout(async () => {
                                    await socket.session.updatePresence("offline", null);

                                    socket.close(4009, 'Session timed out');
                                }, (45 * 1000) + 20 * 1000);
                            },
                            acknowledge: (d) => {
                                socket.session.send({
                                    op: 11,
                                    d: d
                                });

                                logText(`Acknowledged client heartbeat from ${socket.user.id} (${socket.user.username}#${socket.user.discriminator})`, "GATEWAY");
                            }
                        };
                        
                        socket.session.start();

                        await socket.session.prepareReady();

                        socket.session.send({
                            op: 10,
                            s: ++socket.session.seq,
                            d: {
                                heartbeat_interval: 45 * 1000,
                                _trace: ["oldcord-v3"]
                            }
                        });

                        await socket.session.updatePresence("online", null);
                    } else if (packet.op == 1) {
                        if (!socket.hb) return;

                        socket.hb.acknowledge(packet.d);
                        socket.hb.reset();
                    } else if (packet.op == 3) {
                        if (!socket.session) return socket.close(4003, 'Not authenticated');

                        if (socket.cookieStore['release_date'].includes("2015")) {
                            if (packet.d.idle_since == null && packet.d.game_id == null && socket.user.settings.status == 'idle') {
                                await socket.session.updatePresence("online", null);
                            } else if (packet.d.idle_since != null && packet.d.game_id == null) {
                                await socket.session.updatePresence("idle", null);
                            }
                        } else if (socket.cookieStore['release_date'].includes("2016")) {
                            if (packet.d.since != 0 && packet.d.afk == true) {
                                await socket.session.updatePresence("idle", null);
                            } else {
                                let accepted_presences = [
                                    "dnd",
                                    "idle",
                                    "online",
                                    "invisible"
                                ];

                                if (!packet.d.status && packet.d.idle_since && packet.d.idle_since > 0) {
                                    packet.d.status = "idle";
                                }

                                if (!accepted_presences.includes(packet.d.status.toLowerCase())) {
                                    return socket.close(4000, 'Invalid payload');
                                }

                                await socket.session.updatePresence(packet.d.status.toLowerCase(), null);
                            } 
                        }
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
                                game: null,
                                status: socket.user.settings.status,
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
                            socket.send(JSON.stringify({
                                op: 9,
                                d: false
                            }));
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
    regularReady: function (port) {
        gateway.server = new WebSocket.Server({
            port: port
        });

        gateway.handleEvents();
    }
};

module.exports = gateway;
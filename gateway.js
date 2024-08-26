const { logText } = require('./helpers/logger');
const globalUtils = require('./helpers/globalutils');
const WebSocket = require('ws').WebSocket;
const session = require('./helpers/session');
const zlib = require('zlib');

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
    } else if (socket.client_build.includes("2016")) {
        gameField = packet.d.game || null;

        if (packet.d.status) {
            setStatusTo = packet.d.status.toLowerCase();
        }
        
        if (packet.d.afk && packet.d.afk === true) {
            setStatusTo = "idle";
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

                        if (user == null) {
                            return socket.close(4004, "Authentication failed");
                        }

                        socket.user = user;

                        let sesh = new session(globalUtils.generateString(16), socket, user, packet.d.token, false, {
                            game_id: null,
                            status: "offline",
                            user: globalUtils.miniUserObject(socket.user)
                        });

                        socket.session = sesh;        

                        socket.session.start();

                        await socket.session.prepareReady();

                        await socket.session.updatePresence(socket.user.settings.status ?? "online", null);
                    } else if (packet.op == 1) {
                        if (!socket.hb) return;

                        socket.hb.acknowledge(packet.d);
                        socket.hb.reset();
                    } else if (packet.op == 3) {
                        if (!socket.session) return socket.close(4003, 'Not authenticated');

                        await syncPresence(socket, packet);
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
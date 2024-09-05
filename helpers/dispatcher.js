const { logText } = require("./logger");

const dispatcher = {
    dispatchEventTo: async (user_id, type, payload) => {
        let sessions = global.userSessions.get(user_id);
        
        if (!sessions || sessions.size === 0) return false;

        for(let z = 0; z < sessions.length; z++) {
            sessions[z].dispatch(type, payload);
        }
    },
    dispatchGuildMemberUpdateToAllTheirGuilds: async (user_id, new_user) => {
        let sessions = global.userSessions.get(user_id);
        
        if (!sessions || sessions.size === 0) return false;

        for(let z = 0; z < sessions.length; z++) {
            sessions[z].user = new_user;
            
            sessions[z].dispatchSelfUpdate();
        }
    },
    dispatchEventToAllPerms: async (guild_id, channel_id, permission_check, type, payload) => {
        const guild = await global.database.getGuildById(guild_id);

        if (guild == null) return false;

        let channel;

        if (channel_id) {
            channel = guild.channels.find(x => x.id === channel_id);
            
            if (!channel)
                return false;
        }

        const members = guild.members;

        if (members.length == 0) return false;

        for(let i = 0; i < members.length; i++) {
            let member = members[i];

            let uSessions = global.userSessions.get(member.id);

            if (!uSessions) continue;

            for (let z = 0; z < uSessions.length; z++) {
                let uSession = uSessions[z];
                
                if (guild.owner_id != member.id && uSession && uSession.socket) { //Skip checks if owner
                    let guildPermCheck = await global.permissions.hasGuildPermissionTo(guild, member.id, permission_check, uSession.socket.client_build);

                    if (!guildPermCheck)
                        break; //No access to guild

                    if (channel) {
                        const channelPermCheck = await global.permissions.hasChannelPermissionTo(channel, guild, member.id, permission_check);

                        if (!channelPermCheck) {
                            break; //No access to channel
                        }
                    }
                }

                //Success
                uSession.dispatch(type, payload);
            }
        }

        logText(`[DISPATCHER] (Event to all perms) -> ${type}`, 'debug');

        return true;
    },
    dispatchEventInGuild: async (guild, type, payload) => {
        for(let i = 0; i < guild.members.length; i++) {
            let member = guild.members[i];

            if (!member) continue;

            let uSessions = global.userSessions.get(member.id);

            if (!uSessions || uSessions.length === 0) continue;

            for(let z = 0; z < uSessions.length; z++) {
                let socket = uSessions[z].socket;

                if (type == "PRESENCE_UPDATE" && socket && socket.client_build.endsWith("2015")) {
                    let new_status = payload.status;
    
                    payload.status = (new_status != "idle" && new_status != "offline" && new_status != "invisible" && new_status != "dnd") ? "online" : "offline";
                }

                uSessions[z].dispatch(type, payload);
            }
        }

        logText(`[DISPATCHER] (Event in guild) -> ${type}`, 'debug');

        return true;
    },
    dispatchEventInPrivateChannel: async (channel, type, payload) => {
        if (channel === null || !channel.recipients) return false;

        for(let i = 0; i < channel.recipients.length; i++) {
            let recipient = channel.recipients[i].id;

            let uSessions = global.userSessions.get(recipient);

            if (!uSessions || uSessions.length === 0) continue;

            for(let z = 0; z < uSessions.length; z++) {
                uSessions[z].dispatch(type, payload);
            }
        }

        logText(`[DISPATCHER] (Event in group channel) -> ${type}`, 'debug');

        return true;
    },
    dispatchEventInChannel: async (guild, channel_id, type, payload) => {
        if (guild === null) return false;

        const channel = guild.channels.find(x => x.id === channel_id);

        if (channel == null) return false;

        for(let i = 0; i < guild.members.length; i++) {
            let member = guild.members[i];

            if (!member) continue;

            let permissions = await global.permissions.hasChannelPermissionTo(channel, guild, member.id, "READ_MESSAGES");

            if (!permissions) continue;

            let uSessions = global.userSessions.get(member.id);

            if (!uSessions || uSessions.length === 0) continue;

            for(let z = 0; z < uSessions.length; z++) {
                uSessions[z].dispatch(type, payload);
            }
        }

        logText(`[DISPATCHER] (Event in channel) -> ${type}`, 'debug');

        return true;
    }
};

module.exports = dispatcher;
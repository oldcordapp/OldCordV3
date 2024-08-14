const gateway = require("../gateway");
const globalUtils = require("./globalutils");
const { logText } = require("./logger");

const dispatcher = {
    dispatchEventTo: async (user_id, type, payload) => {
        let sessions = global.userSessions.get(user_id);
        
        if (!sessions || sessions.size === 0) return false;

        for(let z = 0; z < sessions.length; z++) {
            sessions[z].dispatch(type, payload);
        }
    },
    dispatchEventInDM: async (author_id, recipient_id, type, payload) => {
        await this.dispatchEventTo(author_id, type, payload);
        await this.dispatchEventTo(recipient_id, type, payload);

        return true;
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

        let chanId = channel_id;
        let checkChannel = true;

        if (chanId == null) {
            chanId = "...";
            checkChannel = false;
        }

        const channel = await global.database.getChannelById(chanId);

        if (channel == null && checkChannel) return false;

        const members = await global.database.getGuildMembers(guild_id);

        if (members.length == 0) return false;

        for(let i = 0; i < members.length; i++) {
            let member = members[i];

            let uSessions = global.userSessions.get(member.id);

            if (!uSessions || uSessions.size === 0) continue;

            let guildPermCheck = await global.permissions.hasGuildPermissionTo(guild.id, member.id, permission_check, socket.cookieStore['release_date']);

            if (checkChannel && channel != null) {
                const channelPermCheck = await global.permissions.hasChannelPermissionTo(channel, guild, member.id, permission_check);

                if (!guildPermCheck && !channelPermCheck && guild.owner_id != member.id) {
                    continue;
                }

                guildPermCheck = true;
            }

            if (!guildPermCheck && guild.owner_id != member.id) {
                continue;
            }

            for(var z = 0; z < uSessions.length; z++) {
                uSessions[z].dispatch(type, payload);
            }
        }

        logText(`[DISPATCHER] (Event to all perms) -> ${type}`, 'debug');

        return true;
    },
    dispatchEventInGuild: async (guild_id, type, payload) => {
        const guild = await global.database.getGuildById(guild_id);

        if (guild == null) {
            return false;
        }

        for(let i = 0; i < guild.members.length; i++) {
            let member = guild.members[i];

            if (!member) continue;

            let uSessions = global.userSessions.get(member.id);

            if (!uSessions || uSessions.size === 0) continue;

            for(let z = 0; z < uSessions.length; z++) {
                let socket = uSessions[z].socket;

                if (type == "PRESENCE_UPDATE" && socket && socket.cookieStore['release_date'].includes("2015")) {
                    let new_status = payload.status;
    
                    payload.status = (new_status != "idle" && new_status != "offline" && new_status != "invisible" && new_status != "dnd") ? "online" : "offline";
                }

                uSessions[z].dispatch(type, payload);
            }
        }

        logText(`[DISPATCHER] (Event in guild) -> ${type}`, 'debug');

        return true;
    },
    dispatchEventInChannel: async (channel_id, type, payload) => {
        const channel = await global.database.getChannelById(channel_id);

        if (channel == null || !channel.guild_id) return false;

        const guild = await global.database.getGuildById(channel.guild_id);

        if (guild == null) return false;

        for(let i = 0; i < guild.members.length; i++) {
            let member = guild.members[i];

            if (!member) continue;

            let permissions = await global.permissions.hasChannelPermissionTo(channel, guild, member.id, "READ_MESSAGES");

            if (!permissions) continue;

            let uSessions = global.userSessions.get(member.id);

            if (!uSessions || uSessions.size === 0) continue;

            for(let z = 0; z < uSessions.length; z++) {
                uSessions[z].dispatch(type, payload);
            }
        }

        logText(`[DISPATCHER] (Event in channel) -> ${type}`, 'debug');

        return true;
    }
};

module.exports = dispatcher;
const gateway = require("../gateway");
const globalUtils = require("./globalutils");
const { logText } = require("./logger");

function nineteeneightyfour(client_build, type, payload) {
    if (type == "CHANNEL_CREATE" || type == "CHANNEL_UPDATE") {

        if (client_build.includes("2016") && globalUtils.requiresIntsForChannelTypes(client_build)) {
            if (typeof payload.type == 'string') {
                payload.type = payload.type == "voice" ? 2 : 0;
            }
        } else if (client_build.includes("2015")) {
            if (typeof payload.type == 'number') {
                payload.type = payload.type == 2 ? "voice" : "text"
            }
        }
    }

    return payload;
}

const dispatcher = {
    queuedEvents: [],
    dispatchEventTo: (token, type, payload) => {
        const socket = gateway.getSocket(token);

        if (socket === undefined) return false;

        if (socket === null) {
            let client = gateway.clients.find(x => x.token == token);

            if (!client) return false;

            if (!dispatcher.queuedEvents[client.session_id]) {
                dispatcher.queuedEvents[client.session_id] = [];
            }

            dispatcher.queuedEvents[client.session_id].push({
                type: type,
                payload: payload
            });

            return true;
        }

        payload = nineteeneightyfour(socket.cookieStore['release_date'], type, payload);

        socket.sequence++;

        gateway.send(socket, {
            op: 0,
            t: type,
            s: socket.sequence,
            d: payload
        }, true);
        
        return true;
    },
    dispatchPresenceUpdate: async (user_id, new_status, game_id) => {
        let user = await globalUtils.database.getAccountByUserId(user_id);

        if (user == null) return false;

        let valid_status = [
            "online",
            "idle",
            "invisible",
            "offline",
            "dnd"
        ];

        if (!valid_status.includes(new_status.toLowerCase())) {
            return false;
        }

        /*
        if (new_status.toLowerCase() != "offline" && new_status.toLowerCase() == user.settings.status.toLowerCase()) {
            //quick fix for some terrible code bugging things out on 2015 clients

            return true;
        }
        */

        if (new_status.toLowerCase() != "offline") {
            user.settings.status = new_status.toLowerCase();

            await globalUtils.database.updateSettings(user.id, user.settings);

            await dispatcher.dispatchEventTo(user.token, "USER_SETTINGS_UPDATE", user.settings);
        }
        
        let guilds = await globalUtils.database.getUsersGuilds(user.id);

        if (guilds.length == 0) {
            await dispatcher.dispatchEventTo(user.token, "PRESENCE_UPDATE", {
                guild_id: null,
                game_id: game_id,
                user: {
                    avatar: user.avatar,
                    discriminator: user.discriminator,
                    id: user.id,
                    username: user.username
                },
                status: new_status
            });

            return true;
        }

        for(var guild of guilds) {
            let status = new_status;

            if (globalUtils.serverRegionToYear(guild.region) == 2015) {
                if (status == "dnd") status = "online";
                else if (status == "invisible") status = "offline";
            }

            await dispatcher.dispatchEventInGuild(guild.id, "PRESENCE_UPDATE", {
                guild_id: guild.id,
                game_id: game_id,
                user: {
                    avatar: user.avatar,
                    discriminator: user.discriminator,
                    id: user.id,
                    username: user.username
                },
                status: status
            });
        }

        return true;
    },
    dispatchInDM: async (sender_id, receiver_id, type, payload) => {
        const sender = await globalUtils.database.getAccountByUserId(sender_id);

        if (sender == null) return false;

        const receiver = await globalUtils.database.getAccountByUserId(receiver_id);

        if (receiver == null) return false;

        await dispatcher.dispatchEventTo(sender.token, type, payload);
        await dispatcher.dispatchEventTo(receiver.token, type, payload);

        return true;
    },
    dispatchEventToAllPerms: async (guild_id, channel_id, permission_check, type, payload) => {
        const guild = await globalUtils.database.getGuildById(guild_id);

        if (guild == null) return false;

        let chanId = channel_id;
        let checkChannel = true;

        if (chanId == null) {
            chanId = "...";
            checkChannel = false;
        }

        const channel = await globalUtils.database.getChannelById(chanId);

        if (channel == null && checkChannel) return false;

        const members = await globalUtils.database.getGuildMembers(guild_id);

        if (members.length == 0) return false;

        for(var member of members) {
            let account = await globalUtils.database.getAccountByUserId(member.id);

            if (account == null) continue;

            let socket = gateway.getSocket(account.token);

            if (socket === undefined) continue;

            if (socket === null) {
                let client = gateway.clients.find(x => x.token == token);

                if (!client) continue;

                dispatcher.queuedEvents[client.session_id].push({
                    type: type,
                    payload: payload
                });
            }

            let guildPermCheck = await globalUtils.permissions.hasGuildPermissionTo(guild.id, account.id, permission_check, socket.cookieStore['release_date']);

            if (checkChannel && channel != null) {
                const channelPermCheck = await globalUtils.permissions.hasChannelPermissionTo(channel, guild, account.id, permission_check);

                if (!guildPermCheck && !channelPermCheck && guild.owner_id != account.id) {
                    continue;
                }

                guildPermCheck = true;
            }

            if (!guildPermCheck && guild.owner_id != account.id) {
                continue;
            }

            payload = nineteeneightyfour(socket.cookieStore['release_date'], type, payload);

            gateway.send(socket, {
                op: 0,
                t: type,
                s: socket.sequence,
                d: payload
            }, true);
        }

        logText(`[DISPATCHER] (Event to all perms) -> ${type}`, 'debug');

        return true;
    },
    dispatchGuildMemberUpdateToAllTheirGuilds: async (user_id) => {
        const user = await globalUtils.database.getAccountByUserId(user_id);

        if (user == null) return false;

        const guilds = await globalUtils.database.getUsersGuilds(user_id);

        if (guilds.length == 0) return false;

        let successCount = 0;

        for(var guild of guilds) {
            let member = await globalUtils.database.getGuildMemberById(guild.id, user.id);

            if (member == null) continue;

            let attempt1 = await dispatcher.dispatchEventInGuild(guild.id, "GUILD_MEMBER_UPDATE", {
                roles: member.roles,
                user: member.user,
                guild_id: guild.id
            });

            let attempt2 = await dispatcher.dispatchEventInGuild(guild.id, "USER_UPDATE", member.user);

            if (attempt1 && attempt2) successCount++;
        }

        return successCount == guilds.length;
    },
    dispatchEventInGuild: async (guild_id, type, payload) => {
        const guild = await globalUtils.database.getGuildById(guild_id);

        if (guild == null) {
            return false;
        }

        const members = await globalUtils.database.getGuildMembers(guild_id);

        if (members.length == 0) {
            return false;
        }

        for(var member of members) {
            let account = await globalUtils.database.getAccountByUserId(member.id);

            if (account == null) {
                continue;
            }

            let socket = gateway.getSocket(account.token);

            if (type == "PRESENCE_UPDATE" && socket && socket.cookieStore['release_date'].includes("2015")) {
                let new_status = payload.status;

                payload.status = (new_status != "idle" && new_status != "offline" && new_status != "invisible" && new_status != "dnd") ? "online" : "offline";
            }

            await dispatcher.dispatchEventTo(account.token, type, payload);
        }

        logText(`[DISPATCHER] (Event in guild) -> ${type}`, 'debug');

        return true;
    },
    dispatchEventInChannel: async (channel_id, type, payload) => {
        const channel = await globalUtils.database.getChannelById(channel_id);

        if (channel == null || !channel.guild_id) return false;

        const guild = await globalUtils.database.getGuildById(channel.guild_id);

        if (guild == null) return false;

        const members = await globalUtils.database.getGuildMembers(channel.guild_id);

        if (members.length == 0) return false;

        for(var member of members) {
            let permissions = await globalUtils.permissions.hasChannelPermissionTo(channel, guild, member.id, "READ_MESSAGES");

            if (!permissions) continue;

            let account = await globalUtils.database.getAccountByUserId(member.id);

            if (account == null) continue;

            var socket = gateway.getSocket(account.token);

            if (socket == null) continue;

            await dispatcher.dispatchEventTo(account.token, type, payload);
        }

        logText(`[DISPATCHER] (Event in channel) -> ${type}`, 'debug');

        return true;
    }
};

module.exports = dispatcher;
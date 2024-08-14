const globalUtils = require('./globalutils');

const permissions = {
    MANAGE_SERVER: 1 << 5,
    MANAGE_ROLES: 1 << 3,
    MANAGE_CHANNELS: 1 << 4,
    KICK_MEMBERS: 1 << 1,
    BAN_MEMBERS: 1 << 2,
    CREATE_INSTANT_INVITE: 1 << 0,
    READ_MESSAGES: 1 << 10,
    SEND_MESSAGES: 1 << 11,
    SEND_TTS_MESSAGES: 1 << 12,
    MANAGE_MESSAGES: 1 << 13,
    EMBED_LINKS: 1 << 14,
    ATTACH_FILES: 1 << 15,
    READ_MESSAGE_HISTORY: 1 << 16,
    MENTION_EVERYONE: 1 << 17,
    CONNECT: 1 << 20,
    ADD_REACTIONS: 1 << 6,
    SPEAK: 1 << 21,
    MUTE_MEMBERS: 1 << 22,
    DEAFEN_MEMBERS: 1 << 23,
    MOVE_MEMBERS: 1 << 24,
    USE_VOICE_ACTIVITY: 1 << 25,
    MANAGE_EMOJIS: 1 << 30,
    database: null,
	has(compare, key) {
        try {
            return !!(BigInt(compare) & BigInt(permissions[key]));
        }
        catch { return false; }
    },
    async hasGuildPermissionTo(guild, user_id, key, for_build) {
        try {
            const member = await global.database.getGuildMemberById(guild.id, user_id);

            if (guild == null) return false;
    
            if (member == null) return false;
    
            if (guild.owner_id == member.id) return true;
    
            if (member.roles.length == 0) return false;
    
            const roles = member.roles;
            const gatheredRoles = []
    
            for(var role2 of roles) {
                var role = await global.database.getRoleById(role2)
    
                if (role != null) {
                    gatheredRoles.push(role);
                }
            }
    
            let highestRole = gatheredRoles[0];
    
            if (for_build.includes("2015")) {
                highestRole = gatheredRoles[gatheredRoles.length - 1];
            }
    
            return permissions.has(highestRole.permissions, key);
        }
        catch { return false; }
    },
    async hasChannelPermissionTo(channel, guild, user_id, key) {
        try {
            if (channel == null || !channel.guild_id) return false;

            if (guild == null) return false;
    
            const member = await global.database.getGuildMemberById(guild.id, user_id);
    
            if (member == null) return false;
    
            if (guild.owner_id == user_id) return true;
    
            let calc = 0;
    
            let memberRoles = [];
    
            for(var role2 of member.roles) {
                var role = await global.database.getRoleById(role2)
    
                if (role != null) {
                    memberRoles.push(role);
    
                    calc |= role.permissions;
                }
            }
    
            if (channel.permission_overwrites && channel.permission_overwrites.length > 0 && !(calc & 8)) {
                let basePerms = Number(calc);
                let overwrites = channel.permission_overwrites;
                let everyone = overwrites?.find(x => x.type == 'role' && x.id == guild.id);
    
                if (everyone) {
                    basePerms &= ~everyone.deny;
                    basePerms |= everyone.allow;
                }
    
                let allow = 0;
                let deny = 0;
    
                for(let memberRole of memberRoles) {
                    let overwrite = overwrites.find(x => x.type =='role' && x.id == memberRole.id);
    
                    if (overwrite) {
                        allow |= overwrite.allow;
                        deny |= overwrite.deny;
                    }
                }
    
                basePerms &= ~deny;
                basePerms |= allow;
    
                let memberOverwrites = overwrites.find(x => x.type == 'member' && x.id == member.id);
    
                if (memberOverwrites) {
                    basePerms &= ~memberOverwrites.deny;
                    basePerms |= memberOverwrites.allow;
                }
    
                calc = basePerms;
            }
    
            if (!!(calc & 8)) {
                return true;
            } //ADMINISTRATOR - It's finally time to use this!
    
            return permissions.has(calc, key);
        }
        catch { return false; }
    }
};

module.exports = permissions;
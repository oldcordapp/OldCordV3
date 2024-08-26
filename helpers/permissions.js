const permissions = {
    CREATE_INSTANT_INVITE: 1 << 0,
    KICK_MEMBERS: 1 << 1,
    BAN_MEMBERS: 1 << 2,
    ADMINISTRATOR: 1 << 3,
    MANAGE_CHANNELS: 1 << 4,
    MANAGE_GUILD: 1 << 5,
    CHANGE_NICKNAME: 1 << 26,
    MANAGE_NICKNAMES: 1 << 27,
    MANAGE_ROLES: 1 << 28,
    MANAGE_WEBHOOKS: 1 << 29,
    MANAGE_EMOJIS: 1 << 30,
    READ_MESSAGES: 1 << 10,
    SEND_MESSAGES: 1 << 11,
    SEND_TTS_MESSAGES: 1 << 12,
    MANAGE_MESSAGES: 1 << 13,
    EMBED_LINKS: 1 << 14,
    ATTACH_FILES: 1 << 15,
    READ_MESSAGE_HISTORY: 1 << 16,
    MENTION_EVERYONE: 1 << 17,
    USE_EXTERNAL_EMOJIS: 1 << 18,
    ADD_REACTIONS: 1 << 6,
    CONNECT: 1 << 20,
    SPEAK: 1 << 21,
    MUTE_MEMBERS: 1 << 22,
    DEAFEN_MEMBERS: 1 << 23,
    MOVE_MEMBERS: 1 << 24,
    USE_VAD: 1 << 25,
	has(compare, key) {
        try {
            return !!(BigInt(compare) & BigInt(permissions[key]));
        }
        catch { return false; }
    },
    async hasGuildPermissionTo(guild, user_id, key, for_build) {
        try {
            const member = guild.members.find(y => y.id == user_id);

            if (guild == null) return false;
    
            if (member == null) return false;
    
            if (guild.owner_id == member.id) return true;
    
            if (member.roles.length === 0) {
                let everyoneRole = guild.roles.find(x => x.id === guild.id);

                return permissions.has(everyoneRole.permissions, key); //@everyone role default perms
            }

            const gatheredRoles = []
            const roles = member.roles;

            for(var role2 of roles) {
                var role = guild.roles.find(x => x.id === role2)
    
                if (role != null) {
                    gatheredRoles.push(role);
                }
            }

            let highestRole = gatheredRoles[0];
    
            if (for_build.endsWith("2015")) {
                highestRole = gatheredRoles[gatheredRoles.length - 1];
            }

            const ADMINISTRATOR = 8;

            if ((highestRole.permissions & ADMINISTRATOR) === ADMINISTRATOR) {
                return true;
            } //admin override
    
            return permissions.has(highestRole.permissions, key);
        }
        catch (error) {
            console.log(error);

            return false;
        }
    },
    async hasChannelPermissionTo(channel, guild, user_id, key) {
        try {
            if (channel == null || !channel.guild_id) return false;

            if (guild == null) return false;

            if (guild.owner_id == user_id) return true;
    
            const member = guild.members.find(y => y.id == user_id);
    
            if (member == null) return false;     
    
            let calc = 0;

            if (member.roles.length === 0) {
                let everyoneRole = guild.roles.find(x => x.id === guild.id);

                calc |= everyoneRole.permissions;
            }
    
            let memberRoles = [];

            for(var role2 of member.roles) {
                var role = guild.roles.find(x => x.id === role2)
    
                if (role != null) {
                    memberRoles.push(role);
    
                    calc |= role.permissions;
                }
            }

            if (channel.permission_overwrites && channel.permission_overwrites.length > 0 && !(calc & 8)) {
                let basePerms = Number(calc);
                let overwrites = channel.permission_overwrites;
                
                let everyone = overwrites.find(x => x.type == 'role' && x.id == guild.id);
    
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
        catch (error) { 
            console.log(error);

            return false; 
        }
    },
    toObject() {
        return {
            CREATE_INSTANT_INVITE: 1 << 0,
            KICK_MEMBERS: 1 << 1,
            BAN_MEMBERS: 1 << 2,
            ADMINISTRATOR: 1 << 3,
            MANAGE_CHANNELS: 1 << 4,
            MANAGE_GUILD: 1 << 5,
            CHANGE_NICKNAME: 1 << 26,
            MANAGE_NICKNAMES: 1 << 27,
            MANAGE_ROLES: 1 << 28,
            MANAGE_WEBHOOKS: 1 << 29,
            MANAGE_EMOJIS: 1 << 30,
            READ_MESSAGES: 1 << 10,
            SEND_MESSAGES: 1 << 11,
            SEND_TTS_MESSAGES: 1 << 12,
            MANAGE_MESSAGES: 1 << 13,
            EMBED_LINKS: 1 << 14,
            ATTACH_FILES: 1 << 15,
            READ_MESSAGE_HISTORY: 1 << 16,
            MENTION_EVERYONE: 1 << 17,
            USE_EXTERNAL_EMOJIS: 1 << 18,
            ADD_REACTIONS: 1 << 6,
            CONNECT: 1 << 20,
            SPEAK: 1 << 21,
            MUTE_MEMBERS: 1 << 22,
            DEAFEN_MEMBERS: 1 << 23,
            MOVE_MEMBERS: 1 << 24,
            USE_VAD: 1 << 25, 
        }
    }
};

module.exports = permissions;
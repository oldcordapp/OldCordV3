const express = require('express');
const { logText } = require('../../helpers/logger');
const globalUtils = require('../../helpers/globalutils');
const router = express.Router();

router.param('userid', async (req, _, next, userid) => {
    req.user = await global.database.getAccountByUserId(userid);

    next();
});

router.get("/", async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    if (account.bot) {
        return res.status(200).json([]); //bots.. ermm
    }

    let relationships = account.relationships;
    
    return res.status(200).json(relationships);
  }
  catch (error) {
    logText(error, "error");

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    });
  }
});

router.delete("/:userid", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (account.bot) {
            return res.status(204).send();
        }

        let user = req.user;

        if (!user) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });
        }

        if (user.bot) {
            return res.status(204).send(); //bots cannot add users
        }

        let ourFriends = account.relationships;
        let theirFriends = user.relationships;
        let ourRelationshipState = ourFriends.find(x => x.user.id == user.id);
        let theirRelationshipState = theirFriends.find(x => x.user.id == account.id);

        if (!ourRelationshipState) {
            ourFriends.push({
                id: user.id,
                type: 0,
                user: globalUtils.miniUserObject(user)
            });

            ourRelationshipState = ourFriends.find(x => x.user.id == user.id);
        }

        if (!theirRelationshipState) {
            theirFriends.push({
                id: account.id,
                type: 0,
                user: globalUtils.miniUserObject(account)
            })

            theirRelationshipState = theirFriends.find(x => x.user.id == account.id);
        }

        if (ourRelationshipState.type === 1 && theirRelationshipState.type === 1) {
            // Unfriend scenario
            ourRelationshipState.type = 0;
            theirRelationshipState.type = 0;

            await global.database.modifyRelationships(account.id, ourFriends);
            await global.database.modifyRelationships(user.id, theirFriends);

            await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_REMOVE", {
                id: user.id
            });

            await global.dispatcher.dispatchEventTo(user.id, "RELATIONSHIP_REMOVE", {
                id: account.id
            });

            return res.status(204).send();
        } else if (ourRelationshipState.type === 2) {
            ourRelationshipState.type = 0;

            await global.database.modifyRelationships(account.id, ourFriends);

            await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_REMOVE", {
                id: user.id
            });

            return res.status(204).send();
        } else if (ourRelationshipState.type === 3) {
            // Declining a friend request
            ourRelationshipState.type = 0;
            theirRelationshipState.type = 0;

            await global.database.modifyRelationships(account.id, ourFriends);
            await global.database.modifyRelationships(user.id, theirFriends);

            await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_REMOVE", {
                id: user.id
            });

            return res.status(204).send();
        } else if (ourRelationshipState.type === 4) {
            //cancelling outgoing friend request

            ourRelationshipState.type = 0;
            theirRelationshipState.type = 0;

            await global.database.modifyRelationships(account.id, ourFriends);
            await global.database.modifyRelationships(user.id, theirFriends);

            await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_REMOVE", {
                id: user.id
            });

            return res.status(204).send();
        } else return res.status(204).send();
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.put("/:userid", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (account.bot) {
            return res.status(204).send();
        }

        let user = req.user;

        if (!user) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });
        }

        if (user.bot) {
            return res.status(204).send();
        }

        let type2 = req.body;
        let type = "SEND_FR";

        let ourFriends = account.relationships;
        let theirFriends = user.relationships;
        let ourRelationshipState = ourFriends.find(x => x.user.id == user.id);
        let theirRelationshipState = theirFriends.find(x => x.user.id == account.id);

        if (JSON.stringify(type2) == '{}') {
            type = "SEND_FR";

            if (ourRelationshipState && ourRelationshipState.type == 3) {
                type = "ACCEPT_FR"
            }
        } else if (type2.type == 2) {
            type = "BLOCK";
        }

        if (!ourRelationshipState) {
            ourFriends.push({
                id: user.id,
                type: 0,
                user: globalUtils.miniUserObject(user)
            });

            ourRelationshipState = ourFriends.find(x => x.user.id == user.id);
        }

        if (!theirRelationshipState) {
            theirFriends.push({
                id: account.id,
                type: 0,
                user: globalUtils.miniUserObject(account)
            })

            theirRelationshipState = theirFriends.find(x => x.user.id == account.id);
        }

        if (type === "SEND_FR") {
            if (ourRelationshipState && (ourRelationshipState.type === 2 || ourRelationshipState.type === 1)) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                });
            }

            if (theirRelationshipState && (theirRelationshipState.type === 2 || theirRelationshipState.type === 1)) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                });
            }

            if (!user.settings.friend_source_flags) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                });
            }

            if (!user.settings.friend_source_flags.all && !user.settings.friend_source_flags.mutual_friends && !user.settings.friend_source_flags.mutual_guilds) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                }); 
            }

            if (!user.settings.friend_source_flags.all) {
                //to-do: handle mutual_guilds, mutual_friends case

                if (user.settings.friend_source_flags.mutual_guilds) {
                    let ourGuilds = await global.database.getUsersGuilds(account.id);

                    if (!ourGuilds) {
                        return res.status(403).json({
                            code: 403,
                            message: "Failed to send friend request"
                        }); 
                    }
    
                    let theirGuilds = await global.database.getUsersGuilds(user.id);
    
                    if (!theirGuilds) {
                        return res.status(403).json({
                            code: 403,
                            message: "Failed to send friend request"
                        }); 
                    }

                    let sharedGuilds = [];

                    for(var ourGuild of ourGuilds) {
                        for(var theirGuild of theirGuilds) {
                            if (theirGuild.members.find(x => x.id === account.id) && ourGuild.members.find(x => x.id === account.id)) {
                                sharedGuilds.push(theirGuild.id);
                            }
                        }
                    }

                    if (sharedGuilds.length === 0) {
                        return res.status(403).json({
                            code: 403,
                            message: "Failed to send friend request"
                        });  
                    }
                }
                
                if (user.settings.friend_source_flags.mutual_friends) {
                    let sharedFriends = [];

                    for (var ourFriend of ourFriends) {
                        for (var theirFriend of theirFriends) {
                            if (theirFriend.user.id === ourFriend.user.id && theirFriend.type === 1 && ourFriend.type === 1) {
                                sharedFriends.push(theirFriend.user);
                            }
                        }
                    }

                    if (sharedFriends.length === 0) {
                        return res.status(403).json({
                            code: 403,
                            message: "Failed to send friend request"
                        }); 
                    }
                }

                ourRelationshipState.type = 4;
                theirRelationshipState.type = 3;
    
                await global.database.modifyRelationships(account.id, ourFriends);
                await global.database.modifyRelationships(user.id, theirFriends);
    
                await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_ADD", {
                    id: user.id,
                    type: 4,
                    user: globalUtils.miniUserObject(user)
                });
    
                await global.dispatcher.dispatchEventTo(user.id, "RELATIONSHIP_ADD", {
                    id: account.id,
                    type: 3,
                    user: globalUtils.miniUserObject(account)
                });
    
                return res.status(204).send();
            } else {
                ourRelationshipState.type = 4;
                theirRelationshipState.type = 3;
    
                await global.database.modifyRelationships(account.id, ourFriends);
                await global.database.modifyRelationships(user.id, theirFriends);
    
                await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_ADD", {
                    id: user.id,
                    type: 4,
                    user: globalUtils.miniUserObject(user)
                });
    
                await global.dispatcher.dispatchEventTo(user.id, "RELATIONSHIP_ADD", {
                    id: account.id,
                    type: 3,
                    user: globalUtils.miniUserObject(account)
                });
    
                return res.status(204).send();
            }   
        } else if (type === "ACCEPT_FR") {
            if (ourRelationshipState && ourRelationshipState.type === 3) {
                ourRelationshipState.type = 1;
                theirRelationshipState.type = 1;

                await global.database.modifyRelationships(account.id, ourFriends);
                await global.database.modifyRelationships(user.id, theirFriends);

                await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_ADD", {
                    id: user.id,
                    type: 1,
                    user: globalUtils.miniUserObject(user)
                });

                await global.dispatcher.dispatchEventTo(user.id, "RELATIONSHIP_ADD", {
                    id: account.id,
                    type: 1,
                    user: globalUtils.miniUserObject(account)
                });

                return res.status(204).send();
            } else {
                return res.status(400).json({
                    code: 400,
                    message: "No pending friend request"
                });
            }
        } else if (type === "BLOCK") {
            ourRelationshipState.type = 2;

            if (theirRelationshipState.type === 1) {
                //ex-friend

                theirRelationshipState.type = 0;

                await global.database.modifyRelationships(user.id, theirFriends);

                await global.dispatcher.dispatchEventTo(user.id, "RELATIONSHIP_REMOVE", {
                    id: account.id
                });
            }

            await global.database.modifyRelationships(account.id, ourFriends);
            
            await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_ADD", {
                id: user.id,
                type: 2,
                user: globalUtils.miniUserObject(user)
            });

            return res.status(204).send();
        }
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.post("/", async (req, res) => {
    try {
        let account = req.account;

        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (account.bot) {
            return res.status(403).json({
                code: 403,
                message: "Failed to send friend request"
            });
        }

        let email = null;

        if (req.body.email) {
            email = req.body.email;
        }

        let username = null;
        let discriminator = null;

        if (req.body.username) {
            username = req.body.username;
        }

        if (req.body.discriminator) {
            discriminator = req.body.discriminator.toString().padStart(4, '0');
        }

        if (!email && !username && !discriminator) {
            return res.status(400).json({
                code: 400,
                message: "An email or username and discriminator combo is required."
            }); 
        }

        if (email) {
            let user = await global.database.getAccountByEmail(email);

            if (!user) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown User"
                }); 
            }

            if (user.settings.allow_email_friend_request != undefined && !user.settings.allow_email_friend_request) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown User"
                }); 
            } //be very vague to protect the users privacy

            let ourFriends = account.relationships;
            let theirFriends = user.relationships;
            let ourRelationshipState = ourFriends.find(x => x.user.id == user.id);
            let theirRelationshipState = theirFriends.find(x => x.user.id == account.id);

            if (!ourRelationshipState) {
                ourFriends.push({
                    id: user.id,
                    type: 0,
                    user: globalUtils.miniUserObject(user)
                });
    
                ourRelationshipState = ourFriends.find(x => x.user.id == user.id);
            }
    
            if (!theirRelationshipState) {
                theirFriends.push({
                    id: account.id,
                    type: 0,
                    user: globalUtils.miniUserObject(account)
                })
    
                theirRelationshipState = theirFriends.find(x => x.user.id == account.id);
            }
            
            if (ourRelationshipState && (ourRelationshipState.type === 2 || ourRelationshipState.type === 1)) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                });
            }

            if (theirRelationshipState && (theirRelationshipState.type === 2 || theirRelationshipState.type === 1)) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                });
            }

            ourRelationshipState.type = 4;
            theirRelationshipState.type = 3;

            await global.database.modifyRelationships(account.id, ourFriends);
            await global.database.modifyRelationships(user.id, theirFriends);

            await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_ADD", {
                id: user.id,
                type: 4,
                user: globalUtils.miniUserObject(user)
            });

            await global.dispatcher.dispatchEventTo(user.id, "RELATIONSHIP_ADD", {
                id: account.id,
                type: 3,
                user: globalUtils.miniUserObject(account)
            });

            return res.status(204).send();
        }
        
        if (username && discriminator) {
            let user = await global.database.getAccountByUsernameTag(username, discriminator);

            if (!user) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown User"
                });
            }

            if (user.bot) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                });
            }

            let ourFriends = account.relationships;
            let theirFriends = user.relationships;
            let ourRelationshipState = ourFriends.find(x => x.user.id == user.id);
            let theirRelationshipState = theirFriends.find(x => x.user.id == account.id);

            if (!ourRelationshipState) {
                ourFriends.push({
                    id: user.id,
                    type: 0,
                    user: globalUtils.miniUserObject(user)
                });
    
                ourRelationshipState = ourFriends.find(x => x.user.id == user.id);
            }
    
            if (!theirRelationshipState) {
                theirFriends.push({
                    id: account.id,
                    type: 0,
                    user: globalUtils.miniUserObject(account)
                })
    
                theirRelationshipState = theirFriends.find(x => x.user.id == account.id);
            }

            if (ourRelationshipState && (ourRelationshipState.type === 2 || ourRelationshipState.type === 1)) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                });
            }

            if (theirRelationshipState && (theirRelationshipState.type === 2 || theirRelationshipState.type === 1)) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                });
            }

            if (!user.settings.friend_source_flags) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                });
            }

            if (!user.settings.friend_source_flags.all && !user.settings.friend_source_flags.mutual_friends && !user.settings.friend_source_flags.mutual_guilds) {
                return res.status(403).json({
                    code: 403,
                    message: "Failed to send friend request"
                }); 
            }

            if (!user.settings.friend_source_flags.all) {
                //to-do: handle mutual_guilds, mutual_friends case

                if (user.settings.friend_source_flags.mutual_guilds) {
                    let ourGuilds = await global.database.getUsersGuilds(account.id);

                    if (!ourGuilds) {
                        return res.status(403).json({
                            code: 403,
                            message: "Failed to send friend request"
                        }); 
                    }
    
                    let theirGuilds = await global.database.getUsersGuilds(user.id);
    
                    if (!theirGuilds) {
                        return res.status(403).json({
                            code: 403,
                            message: "Failed to send friend request"
                        }); 
                    }

                    let sharedGuilds = [];

                    for(var ourGuild of ourGuilds) {
                        for(var theirGuild of theirGuilds) {
                            if (theirGuild.members.find(x => x.id === account.id) && ourGuild.members.find(x => x.id === account.id)) {
                                sharedGuilds.push(theirGuild.id);
                            }
                        }
                    }

                    if (sharedGuilds.length === 0) {
                        return res.status(403).json({
                            code: 403,
                            message: "Failed to send friend request"
                        });  
                    }
                }
                
                if (user.settings.friend_source_flags.mutual_friends) {
                    let sharedFriends = [];

                    for (var ourFriend of ourFriends) {
                        for (var theirFriend of theirFriends) {
                            if (theirFriend.user.id === ourFriend.user.id && theirFriend.type === 1 && ourFriend.type === 1) {
                                sharedFriends.push(theirFriend.user);
                            }
                        }
                    }

                    if (sharedFriends.length === 0) {
                        return res.status(403).json({
                            code: 403,
                            message: "Failed to send friend request"
                        }); 
                    }
                }

                ourRelationshipState.type = 4;
                theirRelationshipState.type = 3;
    
                await global.database.modifyRelationships(account.id, ourFriends);
                await global.database.modifyRelationships(user.id, theirFriends);
    
                await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_ADD", {
                    id: user.id,
                    type: 4,
                    user: globalUtils.miniUserObject(user)
                });
    
                await global.dispatcher.dispatchEventTo(user.id, "RELATIONSHIP_ADD", {
                    id: account.id,
                    type: 3,
                    user: globalUtils.miniUserObject(account)
                });
    
                return res.status(204).send();
            } else {
                ourRelationshipState.type = 4;
                theirRelationshipState.type = 3;
    
                await global.database.modifyRelationships(account.id, ourFriends);
                await global.database.modifyRelationships(user.id, theirFriends);
    
                await global.dispatcher.dispatchEventTo(account.id, "RELATIONSHIP_ADD", {
                    id: user.id,
                    type: 4,
                    user: globalUtils.miniUserObject(user)
                });
    
                await global.dispatcher.dispatchEventTo(user.id, "RELATIONSHIP_ADD", {
                    id: account.id,
                    type: 3,
                    user: globalUtils.miniUserObject(account)
                });
    
                return res.status(204).send();
            }   
        }

        return res.status(400).json({
            code: 400,
            message: "An email or username and discriminator combo is required."
        })
    } catch (error) {
        logText(error, "error");

        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

module.exports = router;
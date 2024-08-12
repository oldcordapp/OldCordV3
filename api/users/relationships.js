const express = require('express');
const globalUtils = require('../../helpers/globalutils');
const dispatcher = require('../../helpers/dispatcher');
const { rateLimitMiddleware } = require('../../helpers/middlewares');
const { logText } = require('../../helpers/logger');
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }

    let relationships = await globalUtils.database.getRelationshipsByUserId(account.id);
    
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

router.put("/:userid", async (req, res) => {
    try {
        let account = req.account;
    
        if (!account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let user = req.user;

        if (!user) {
            return res.status(404).json({
                code: 404,
                message: "Unauthorized"
            }); 
        }

        let type = req.body;

        if (JSON.stringify(type) == '{}') {
            type = "SEND_FR"
        } else if (type.type == 2) {
            type = "BLOCK"
        }

        if (type == 'SEND_FR') {
            let friend_flags = user.settings.friend_source_flags;

            if (friend_flags.all == false && friend_flags.mutual_friends == false && friend_flags.mutual_guilds == false) {
                return res.status(403).json({
                    code: 403,
                    message: "Missing Permissions"
                });
            }
            
            let canFrGuilds = false;
            let canFrFriends = false;
            let ourFriends = [];
            let theirFriends = [];
    
            if (friend_flags.all == false) {
                if (friend_flags.mutual_guilds == true) {
                    let guilds = await globalUtils.database.getUsersGuilds(user.id);
    
                    canFrGuilds = guilds.length > 0 && guilds.some(guild => guild.members != null && guild.members.length > 0 && guild.members.some(member => member.id === account.id));
                }
    
                if (friend_flags.mutual_friends == true) {
                    ourFriends = await globalUtils.database.getRelationshipsByUserId(account.id);
                    theirFriends = await globalUtils.database.getRelationshipsByUserId(user.id);
        
                    let sharedFriends = [];
                    
                    if (ourFriends.length > 0 && theirFriends.length > 0) {
                        let theirFriendsSet = new Set(theirFriends.map(friend => friend.user.id && friend.type == 1));
                    
                        for (let ourFriend of ourFriends) {
                            if (theirFriendsSet.has(ourFriend.user.id) && ourFriend.type == 1) {
                                sharedFriends.push(ourFriend.user);
                            }
                        }
                    }
    
                    canFrFriends = sharedFriends.length > 0;
                }
    
                if (!canFrGuilds && !canFrFriends) {
                    return res.status(403).json({
                        code: 403,
                        message: "Missing Permissions"
                    });
                }

                //type 0 for none, 1 for friend, 2 for blocked, 3 for pending incoming, 4 for pending outgoing

                let relationships = ourFriends;
                let theirRelationships = theirFriends;
                let hasPreviousFr1 = relationships.find(x => x.id == user.id);
                let hasPreviousFr2 = relationships.find(y => y.id == account.id);

                if (hasPreviousFr1 && hasPreviousFr1.type == 2) {
                    return res.status(400).json({
                        code: 400,
                        message: "You have this user blocked. Unblock them first before sending a friend request."
                    });
                }

                if (hasPreviousFr2 && hasPreviousFr2.type == 2) {
                    return res.status(403).json({
                        code: 403,
                        message: "Missing Permissions"
                    });
                }

                if (hasPreviousFr1) {
                    return res.status(204).send();
                }

                if (hasPreviousFr2) {
                    return res.status(204).send();
                }

                relationships.push({
                    id: user.id,
                    type: 4
                });

                theirRelationships.push({
                    id: account.id,
                    type: 3
                });
    
                let trySetOutgoing = await globalUtils.database.modifyRelationships(account.id, relationships);
                let trySetIncoming = await globalUtils.database.modifyRelationships(user.id, theirRelationships);
    
                if (!trySetOutgoing) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }
    
                if (!trySetIncoming) {
                    return res.status(500).json({
                        code: 500,
                        message: "Internal Server Error"
                    });
                }
    
                return res.status(204).send();
            }
    
            ourFriends = await globalUtils.database.getRelationshipsByUserId(account.id);
            theirFriends = await globalUtils.database.getRelationshipsByUserId(user.id);

            let relationships = ourFriends;
            let theirRelationships = theirFriends;
            let hasPreviousFr1 = relationships.find(x => x.id == user.id);
            let hasPreviousFr2 = relationships.find(y => y.id == account.id);

            if (hasPreviousFr1 && hasPreviousFr1.type == 2) {
                return res.status(400).json({
                    code: 400,
                    message: "You have this user blocked. Unblock them first before sending a friend request."
                });
            }

            if (hasPreviousFr2 && hasPreviousFr2.type == 2) {
                return res.status(403).json({
                    code: 403,
                    message: "Missing Permissions"
                });
            }

            if (hasPreviousFr1) {
                return res.status(204).send();
            }

            if (hasPreviousFr2) {
                return res.status(204).send();
            }

            relationships.push({
                id: user.id,
                type: 4
            });

            theirRelationships.push({
                id: account.id,
                type: 3
            });

            let trySetOutgoing = await globalUtils.database.modifyRelationships(account.id, relationships);
            let trySetIncoming = await globalUtils.database.modifyRelationships(user.id, theirRelationships);
    
            if (!trySetOutgoing) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
    
            if (!trySetIncoming) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }
    
            return res.status(204).send();
        } else if (type == 'BLOCK') { 
            return res.status(204).send();
        }
      }
      catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
      }
});

module.exports = router;
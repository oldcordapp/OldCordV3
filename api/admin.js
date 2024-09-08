const express = require('express');
const { logText } = require('../helpers/logger');
const { staffAccessMiddleware } = require('../helpers/middlewares');
const router = express.Router({ mergeParams: true });

//PRIVILEGE: 1 - (JANITOR) [Can only flag things for review], 2 - (MODERATOR) [Can only delete messages, mute users, and flag things for review], 3 - (ADMIN) [Free reign, can review flags, disable users, delete servers, etc], 4 - (INSTANCE OWNER) - [Can add new admins, manage staff, etc]

router.param('userid', async (req, res, next, userid) => {
    req.user = await global.database.getAccountByUserId(userid);
  
    next();
});

router.get("/guilds/search", staffAccessMiddleware(1), async (req, res) => {
    try {
        let search = req.query.input;

        if (!search) {
            return res.status(400).json({
                code: 400,
                search: "This field is required."
            });  
        }

        let tryNumber = parseInt(search);
        let isGuildId = false;

        if (!isNaN(tryNumber)) {
            isGuildId = true;
        }

        if (!isGuildId) {
            return res.status(400).json({
                code: 400,
                message: "Guild partial name/name search is not implemented."
            });
        }

        let guild = await global.database.getGuildById(search);

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        return res.status(200).json(guild);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/users/bulk-disable", staffAccessMiddleware(3), async (req, res) => {
    try {
        let users = req.body.users;
        let public_reason = req.body.public_reason;
        let audit_log_reason = req.body.audit_log_reason;
        let until = req.body.disabled_until;

        if (!users) {
            return res.status(400).json({
                code: 400,
                message: "Bad bulk-disable request (Expected 'users' but got none)"
            });
        }

        if (!Array.isArray(users) || users.length === 0) {
            return res.status(400).json({
                code: 400,
                message: "Bad bulk-disable request (Expected 'users' of type 'Array' but hadn't received it)"
            });
        }

        if (!until) {
            return res.status(400).json({
                code: 400,
                disabled_until: "This field is required."
            });  
        }

        if (!public_reason) {
            return res.status(400).json({
                code: 400,
                public_reason: "This field is required."
            });
        }

        if (!audit_log_reason) {
            return res.status(400).json({
                code: 400,
                audit_log_reason: "This field is required."
            });
        }

        let audit_entries = [];

        for(var user of users) {
            if (user === req.account.id) continue; //what the fuck lol?

            let tryGetUser = await global.database.getAccountByUserId(user);

            if (!tryGetUser || tryGetUser.disabled_until) {
                continue;
            }

            let tryDisable = await global.database.internalDisableAccount(req.staff_details, user, until ?? "FOREVER", public_reason, audit_log_reason);

            if (tryDisable) {
                audit_entries.push(tryDisable);

                await global.dispatcher.dispatchEventTo(user, "LOGOUT", null);
            }
        }

        if (audit_entries.length < users.length) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });   
        }

        return res.status(200).json(audit_entries);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/users/:userid/moderate/disable", staffAccessMiddleware(3), async (req, res) => {
    try {
        let user = req.user;

        if (!user) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });  
        }

        if (user.id === req.account.id) {
            return res.status(404).json({
                code: 404,
                message: "Unknown User"
            });
        }

        if (user.disabled_until) {
            return res.status(400).json({
                code: 400,
                message: "User is already disabled."
            }); 
        }

        let until = req.body.disabled_until;

        if (!until) {
            return res.status(400).json({
                code: 400,
                disabled_until: "This field is required."
            });  
        }

        let public_reason = req.body.reason;
        let audit_log_reason = req.body.audit_log_reason;

        if (!public_reason) {
            return res.status(400).json({
                code: 400,
                public_reason: "This field is required."
            });
        }

        if (!audit_log_reason) {
            return res.status(400).json({
                code: 400,
                audit_log_reason: "This field is required."
            });
        }

        let tryDisable = await global.database.internalDisableAccount(req.staff_details, req.params.userid, until ?? "FOREVER", public_reason, audit_log_reason);

        if (!tryDisable) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }
        
        return res.status(200).json(tryDisable);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
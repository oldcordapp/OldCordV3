const express = require('express');
const globalUtils = require('../../helpers/globalutils');
const dispatcher = require('../../helpers/dispatcher');
const { rateLimitMiddleware } = require('../../helpers/middlewares');
const { logText } = require('../../helpers/logger');
const router = express.Router();

router.get("/relationships", async (req, res) => {
  return res.status(200).json([]);
});

router.get("/", async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      });
    }

    delete account.settings;
    delete account.token;
    delete account.password;
    
    return res.status(200).json(account);
  }
  catch (error) {
    logText(error.toString(), "error");

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    });
  }
});

router.patch("/", rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      });
    }

    delete account.settings;
    delete account.created_at;

    if (!req.body.avatar || req.body.avatar == "") req.body.avatar = null;

    if (!req.body.email || req.body.email == "") req.body.email = null;

    if (!req.body.new_password || req.body.new_password == "") req.body.new_password = null;

    if (!req.body.password || req.body.password == "") req.body.password = null;

    if (!req.body.username || req.body.username == "") req.body.username = null;

    let update_object = {
      avatar: req.body.avatar == ("" || null || undefined) ? null : req.body.avatar,
      email: req.body.email == ("" || null || undefined) ? null : req.body.email,
      new_password: req.body.new_password == ("" || null || undefined) ? null : req.body.new_password,
      password: req.body.password == ("" || null || undefined) ? null : req.body.password,
      username: req.body.username == ("" || null || undefined) ? null : req.body.username
    };

    if (update_object.email == account.email && update_object.new_password == null && update_object.password == null && update_object.username == account.username) {
       //avatar change

      const attemptToUpdateAvi = await globalUtils.database.updateAccount(update_object.avatar, account.email, account.username, null, null, null);

      if (attemptToUpdateAvi) {
        let account2 = await globalUtils.database.getAccountByEmail(account.email);

        if (account2 != null && account2.token) {
          delete account2.password;
          delete account2.settings;
          delete account2.created_at;

          dispatcher.dispatchEventTo(account2.token, "USER_UPDATE", account2);

          await dispatcher.dispatchGuildMemberUpdateToAllTheirGuilds(account2.id);

          return res.status(200).json(account2);
        }
      } else return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      });
    } else {
      if (update_object.password == null) {
        return res.status(400).json({
          code: 400,
          password: "This field is required"
        });
      }

      if (update_object.email == null) {
        return res.status(400).json({
          code: 400,
          email: "This field is required"
        });
      }

      if (update_object.username == null) {
        return res.status(400).json({
          code: 400,
          username: "This field is required"
        });
      }

      if (update_object.username.length < 2 || update_object.username.length > 32) {
        return res.status(400).json({
          code: 400,
          username: "Must be between 2 and 32 characters"
        });
      }

      if (update_object.email.length < 2 || update_object.email.length > 32) {
        return res.status(400).json({
          code: 400,
          email: "Must be between 2 and 32 characters"
        });
      }

      if (update_object.new_password && update_object.new_password.length > 64) {
        return res.status(400).json({
          code: 400,
          password: "Must be under 64 characters"
        });
      }

      const correctPassword = await globalUtils.database.doesThisMatchPassword(update_object.password, account.password);

        if (!correctPassword) {
          return res.status(400).json({
            code: 400,
            password: "Incorrect password"
          })
        }

      if ((update_object.email != account.email || update_object.username != account.username) || (update_object.email != account.email && update_object.username != account.username)) {
        const correctPassword = await globalUtils.database.doesThisMatchPassword(update_object.password, account.password);

        if (!correctPassword) {
          return res.status(400).json({
            code: 400,
            password: "Incorrect password"
          })
        }

        const update = await globalUtils.database.updateAccount(update_object.avatar, account.email, update_object.username, update_object.password, update_object.new_password, update_object.email);

        if (update) {
          let account2 = await globalUtils.database.getAccountByEmail(update_object.email);
  
          if (account2 != null && account2.token) {
            delete account2.settings;
            delete account2.password;
            delete account2.created_at;
  
            dispatcher.dispatchEventTo(account2.token, "USER_UPDATE", account2);

            await dispatcher.dispatchGuildMemberUpdateToAllTheirGuilds(account2.id);
            
            return res.status(200).json(account2);
          }
        }
      } else if (update_object.new_password != null) {
        const correctPassword = await globalUtils.database.doesThisMatchPassword(update_object.password, account.password);

        if (!correctPassword) {
          return res.status(400).json({
            code: 400,
            password: "Incorrect password"
          })
        }

        const update = await globalUtils.database.updateAccount(update_object.avatar, account.email, update_object.username, update_object.password, update_object.new_password, update_object.email);

        if (update) {
          let account2 = await globalUtils.database.getAccountByEmail(update_object.email);
  
          if (account2 != null && account2.token) {
            delete account2.settings;
            delete account2.password;
            delete account2.created_at;
  
            dispatcher.dispatchEventTo(account2.token, "USER_UPDATE", account2);

            await dispatcher.dispatchGuildMemberUpdateToAllTheirGuilds(account2.id);
            
            return res.status(200).json(account2);
          }
        }
      }
    }

    if (account != null) {
      delete account.password;
      delete account.settings;
      delete account.created_at;
    }

    return res.status(200).json(account);
  } catch (error) {
    logText(error.toString(), "error");

    console.log(error.toString());

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    });
  }
});

router.patch("/settings", async (req, res) => {
  try {
    let account = req.account;

    if (!account) {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      }); 
    }

    let new_settings = account.settings;
    
    if (new_settings == null) {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      });
    }

    for (var key in req.body) {
      var value = req.body[key];

      if (new_settings[key]) {
        new_settings[key] = value;
      }
    }

    if (JSON.stringify(new_settings).length > 1000) {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      });
    }

    const attempt = await globalUtils.database.updateSettings(account.id, new_settings);

    if (attempt) {
      const settings = new_settings;

      dispatcher.dispatchEventTo(account.token, "USER_SETTINGS_UPDATE", settings);

      return res.status(204).send();
    } else {
      return res.status(500).json({
        code: 500,
        message: "Internal Server Error"
      })
    }
  } catch (error) {
    logText(error.toString(), "error");

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    })
  }
});

module.exports = router;
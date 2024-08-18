const express = require('express');
const { logText } = require('../helpers/logger');

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    if (!req.account) {
        return res.status(401).json({
            code: 401,
            message: "Unauthorized"
        });
    }
    
    return res.status(200).json({
        indicators_suppressed: true,
        indicators_confirmed: [
            "direct-messages",
            "voice-conversations",
            "organize-by-topic",
            "writing-messages",
            "instant-invite",
            "server-settings",
            "create-more-servers",
            "friends-list",
            "whos-online",
            "create-first-server"
        ]
    })
  } catch (error) {
    logText(error, "error");

    return res.status(500).json({
      code: 500,
      message: "Internal Server Error"
    });
  }
});

router.post("/indicators/suppress", async (req, res) => {
    try {
        if (!req.account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        return res.status(200).json({
            indicators_suppressed: true,
            indicators_confirmed: [
                "direct-messages",
                "voice-conversations",
                "organize-by-topic",
                "writing-messages",
                "instant-invite",
                "server-settings",
                "create-more-servers",
                "friends-list",
                "whos-online",
                "create-first-server"
            ]
        })
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.put("/indicators/:indicator", async (req, res) => {
    try {
        if (!req.account) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        return res.status(200).json({
            indicators_suppressed: true,
            indicators_confirmed: [
                "direct-messages",
                "voice-conversations",
                "organize-by-topic",
                "writing-messages",
                "instant-invite",
                "server-settings",
                "create-more-servers",
                "friends-list",
                "whos-online",
                "create-first-server"
            ]
        });
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;
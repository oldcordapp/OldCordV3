const express = require('express');
const router = express.Router();

router.get("/stable", async (req, res) => {
    return res.status(204).send();
});

router.get("/stable/versions.json", async (req, res) => {
    return res.status(204).send();
});

module.exports = router;
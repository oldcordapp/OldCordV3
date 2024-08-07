const express = require('express');
const globalUtils = require('../helpers/globalutils');

const router = express.Router({ mergeParams: true });

router.get("/regions", async (_, res) => {
    return res.status(200).json(globalUtils.getRegions());
});

module.exports = router;
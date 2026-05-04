const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { indexFile, indexFiles } = require("../services/indexing.service");

const router = express.Router();

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const result = await indexFile({
      projectId: req.body.projectId,
      fileName: req.body.fileName,
      text: req.body.text,
    });

    res.json(result);
  })
);

router.post(
  "/batch",
  asyncHandler(async (req, res) => {
    const result = await indexFiles({
      projectId: req.body.projectId,
      files: req.body.files,
    });

    res.json(result);
  })
);

module.exports = router;

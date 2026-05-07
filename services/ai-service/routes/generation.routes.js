const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { generateProjectManifest } = require("../services/project-generator.service");

const router = express.Router();

router.post(
  "/godot-project",
  asyncHandler(async (req, res) => {
    const manifest = await generateProjectManifest({
      prompt: req.body.prompt,
      assets: req.body.assets,
    });

    res.json(manifest);
  })
);

module.exports = router;

const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { generateProjectManifest } = require("../services/project-generator.service");
const { logger } = require("../utils/logger");

const router = express.Router();

const getGenerationOptions = (body = {}) => ({
  mode: body.mode || "free",
  targetGodotVersion: body.targetGodotVersion || "4.6",
  validationEnabled: body.validationEnabled !== false,
  cliValidationEnabled:
    typeof body.cliValidationEnabled === "boolean" ? body.cliValidationEnabled : undefined,
  repairIterations: body.repairIterations,
  projectPath: body.projectPath,
});

router.post(
  "/godot-project",
  asyncHandler(async (req, res) => {
    const manifest = await generateProjectManifest({
      prompt: req.body.prompt,
      assets: req.body.assets,
      attachments: req.body.attachments,
      options: getGenerationOptions(req.body),
    });

    res.json(manifest);
  })
);

router.post("/godot-project/stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const writeEvent = (event) => {
    res.write(`${JSON.stringify(event)}\n`);
  };
  let lastProgress;

  try {
    const manifest = await generateProjectManifest({
      prompt: req.body.prompt,
      assets: req.body.assets,
      attachments: req.body.attachments,
      options: getGenerationOptions(req.body),
      onProgress: (progress) => {
        lastProgress = progress;
        writeEvent({ type: "progress", ...progress });
      },
    });

    writeEvent({ type: "result", manifest });
  } catch (error) {
    logger.error("Godot generation stream failed", {
      message: error instanceof Error ? error.message : String(error),
      stage: lastProgress?.stage,
      lastMessage: lastProgress?.message,
      statusCode: error.statusCode,
      code: error.code,
    });
    writeEvent({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      stage: lastProgress?.stage,
      lastMessage: lastProgress?.message,
      code: error.code,
    });
  } finally {
    res.end();
  }
});

module.exports = router;

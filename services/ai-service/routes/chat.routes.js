const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const {
  streamChat,
  streamCodeGeneration,
  streamInlineEdit,
} = require("../services/chat.service");
const { logger } = require("../utils/logger");

const router = express.Router();
const STREAM_EVENT_PREFIX = "\u001e";

const writeStreamEvent = (res, event) => {
  res.write(`${STREAM_EVENT_PREFIX}${JSON.stringify(event)}\n`);
};

router.post(
  "/",
  asyncHandler(async (req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      await streamChat({
        projectId: req.body.projectId,
        message: req.body.message,
        selectedCode: req.body.selectedCode,
        selectedFile: req.body.selectedFile,
        activeFileContent: req.body.activeFileContent,
        intent: req.body.intent,
        onModelSwitch: ({ from, to }) =>
          writeStreamEvent(res, { type: "model-switch", from, to }),
        onToken: (token) => res.write(token),
      });

      res.end();
    } catch (error) {
      if (!res.headersSent) throw error;

      logger.error("Streaming chat failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      res.write("\n\nChat stream failed. Check the local AI service logs.");
      res.end();
    }
  })
);

router.post(
  "/generate",
  asyncHandler(async (req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      await streamCodeGeneration({
        projectId: req.body.projectId,
        instruction: req.body.instruction,
        selectedCode: req.body.selectedCode,
        selectedFile: req.body.selectedFile,
        activeFileContent: req.body.activeFileContent,
        onModelSwitch: ({ from, to }) =>
          writeStreamEvent(res, { type: "model-switch", from, to }),
        onToken: (token) => res.write(token),
      });

      res.end();
    } catch (error) {
      if (!res.headersSent) throw error;

      logger.error("Streaming code generation failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      res.write("\n\nCode generation failed. Check the AI service logs.");
      res.end();
    }
  })
);

router.post(
  "/inline",
  asyncHandler(async (req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      await streamInlineEdit({
        projectId: req.body.projectId,
        instruction: req.body.instruction,
        selectedCode: req.body.selectedCode,
        selectedFile: req.body.selectedFile,
        activeFileContent: req.body.activeFileContent,
        onModelSwitch: ({ from, to }) =>
          writeStreamEvent(res, { type: "model-switch", from, to }),
        onToken: (token) => res.write(token),
      });

      res.end();
    } catch (error) {
      if (!res.headersSent) throw error;

      logger.error("Streaming inline edit failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      res.write("\n\nInline edit failed. Check the local AI service logs.");
      res.end();
    }
  })
);

module.exports = router;

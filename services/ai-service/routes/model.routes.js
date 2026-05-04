const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const {
  listOpenRouterModels,
  selectChatModel,
} = require("../services/model.service");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listOpenRouterModels());
  })
);

router.post(
  "/select",
  asyncHandler(async (req, res) => {
    res.json(await selectChatModel(req.body.model));
  })
);

router.post(
  "/delete",
  asyncHandler(async (req, res) => {
    res.status(410).json({
      error: "OpenRouter models are remote and cannot be deleted locally.",
      model: req.body.model,
    });
  })
);

router.post(
  "/pull",
  asyncHandler(async (req, res) => {
    res.status(410).json({
      error: "OpenRouter models are selected by id and do not need local pulls.",
      model: req.body.model,
    });
  })
);

module.exports = router;

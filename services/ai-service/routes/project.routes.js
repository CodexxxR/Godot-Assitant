const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const {
  forgetProject,
  getProject,
  getProjectStats,
  listProjects,
  registerProject,
} = require("../services/project.service");
const { deleteProjectChunks } = require("../services/vector.service");
const { requireString } = require("../utils/validation");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ projects: listProjects() });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const rootPath = requireString(req.body.rootPath, "rootPath");
    const name =
      typeof req.body.name === "string" && req.body.name.trim()
        ? req.body.name.trim()
        : undefined;

    const project = registerProject({ name, rootPath });
    res.status(201).json(project);
  })
);

router.get(
  "/:projectId",
  asyncHandler(async (req, res) => {
    const projectId = requireString(req.params.projectId, "projectId");
    const project = getProject(projectId);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json(project);
  })
);

router.get(
  "/:projectId/stats",
  asyncHandler(async (req, res) => {
    const projectId = requireString(req.params.projectId, "projectId");
    const stats = getProjectStats(projectId);

    if (!stats) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json(stats);
  })
);

router.delete(
  "/:projectId",
  asyncHandler(async (req, res) => {
    const projectId = requireString(req.params.projectId, "projectId");
    const deletedChunks = await deleteProjectChunks(projectId);
    const projectForgotten = forgetProject(projectId);

    res.json({
      projectId,
      deletedChunks,
      projectForgotten,
    });
  })
);

module.exports = router;

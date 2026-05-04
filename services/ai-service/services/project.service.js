const fs = require("fs");
const path = require("path");
const { analyzeFile, normalizePath, resolveImport } = require("../utils/code-intelligence");
const { sha1 } = require("../utils/hash");
const { logger } = require("../utils/logger");

const dataDirectory = path.join(__dirname, "..", "data");
const projectsFile = path.join(dataDirectory, "projects.json");
const projects = new Map();

const ensureDataDirectory = () => {
  fs.mkdirSync(dataDirectory, { recursive: true });
};

const readPersistedProjects = () => {
  ensureDataDirectory();

  if (!fs.existsSync(projectsFile)) return;

  try {
    const parsed = JSON.parse(fs.readFileSync(projectsFile, "utf8"));
    Object.values(parsed.projects || {}).forEach((project) => {
      projects.set(project.projectId, {
        ...project,
        files: project.files || {},
      });
    });
    logger.info("Project metadata loaded", { projects: projects.size });
  } catch (error) {
    logger.warn("Could not load persisted project metadata", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const persistProjects = () => {
  ensureDataDirectory();

  const payload = {
    projects: Object.fromEntries(projects.entries()),
  };

  fs.writeFileSync(projectsFile, JSON.stringify(payload, null, 2));
};

readPersistedProjects();

const normalizeProjectFiles = (files = {}) => Object.fromEntries(
  Object.entries(files).map(([fileName, file]) => [
    normalizePath(fileName),
    {
      ...file,
      fileName: normalizePath(file.fileName || fileName),
      imports: file.imports || [],
      resolvedImports: file.resolvedImports || [],
      importedBy: file.importedBy || [],
      exports: file.exports || [],
    },
  ])
);

const recomputeIncomingEdges = (project) => {
  Object.values(project.files).forEach((file) => {
    file.importedBy = [];
  });

  Object.values(project.files).forEach((file) => {
    file.resolvedImports.forEach((importedFileName) => {
      const importedFile = project.files[normalizePath(importedFileName)];
      if (!importedFile) return;
      importedFile.importedBy = Array.from(
        new Set([...(importedFile.importedBy || []), file.fileName])
      );
    });
  });
};

const recomputeFileRelationships = (project) => {
  const knownFiles = new Set(Object.keys(project.files || {}));

  Object.values(project.files).forEach((file) => {
    file.resolvedImports = Array.from(
      new Set(
        (file.imports || [])
          .map((specifier) =>
            resolveImport({
              fromFile: file.fileName,
              specifier,
              knownFiles,
            })
          )
          .filter(Boolean)
      )
    );
  });

  recomputeIncomingEdges(project);
};

const registerProject = ({ name, rootPath }) => {
  const normalizedName = name || rootPath.split(/[\\/]/).filter(Boolean).pop();
  const projectId = sha1(rootPath || normalizedName).slice(0, 16);
  const existingProject = projects.get(projectId);
  const project = {
    ...(existingProject || {}),
    projectId,
    name: normalizedName,
    rootPath,
    registeredAt: existingProject?.registeredAt || new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    files: normalizeProjectFiles(existingProject?.files || {}),
  };

  recomputeFileRelationships(project);
  projects.set(projectId, project);
  persistProjects();
  logger.info("Project registered", { projectId, name: normalizedName });

  return project;
};

const getProject = (projectId) => projects.get(projectId) || null;

const listProjects = () =>
  Array.from(projects.values()).sort((a, b) =>
    String(b.lastOpenedAt || "").localeCompare(String(a.lastOpenedAt || ""))
  );

const recordIndexedFile = ({ projectId, fileName, text, chunks, knownFileNames = [] }) => {
  const project = getProject(projectId);
  if (!project) return null;

  const normalizedFileName = normalizePath(fileName);
  const knownFiles = Array.from(
    new Set([
      ...knownFileNames.map(normalizePath),
      ...Object.keys(project.files || {}),
      normalizedFileName,
    ])
  );
  const analysis = analyzeFile({
    text,
    fileName: normalizedFileName,
    knownFileNames: knownFiles,
  });

  project.files[normalizedFileName] = {
    ...analysis,
    fileName: normalizedFileName,
    indexedAt: new Date().toISOString(),
    chunkCount: chunks.length,
  };
  project.lastIndexedAt = new Date().toISOString();
  recomputeFileRelationships(project);
  persistProjects();

  return project.files[normalizedFileName];
};

const getProjectGraph = (projectId, focusFileName) => {
  const project = getProject(projectId);
  if (!project) {
    return {
      files: {},
      focusFile: null,
      relatedFiles: [],
    };
  }

  const normalizedFocusFileName = focusFileName ? normalizePath(focusFileName) : "";
  const focusFile = project.files[normalizedFocusFileName] || null;
  const relatedFiles = focusFile
    ? Array.from(
        new Set([
          normalizedFocusFileName,
          ...(focusFile.resolvedImports || []),
          ...(focusFile.importedBy || []),
        ])
      )
    : [];

  return {
    files: project.files,
    focusFile,
    relatedFiles,
  };
};

const getProjectStats = (projectId) => {
  const project = getProject(projectId);
  if (!project) return null;

  const files = Object.values(project.files || {});
  const chunkCount = files.reduce((sum, file) => sum + Number(file.chunkCount || 0), 0);

  return {
    projectId,
    indexedFiles: files.length,
    indexedChunks: chunkCount,
    lastIndexedAt: project.lastIndexedAt || null,
    files: files.map((file) => ({
      fileName: file.fileName,
      indexedAt: file.indexedAt,
      chunkCount: file.chunkCount || 0,
      imports: file.imports || [],
      resolvedImports: file.resolvedImports || [],
      importedBy: file.importedBy || [],
      exports: file.exports || [],
    })),
  };
};

const forgetProject = (projectId) => {
  const existed = projects.delete(projectId);
  persistProjects();
  logger.info("Project forgotten", { projectId, existed });
  return existed;
};

module.exports = {
  registerProject,
  getProject,
  getProjectGraph,
  getProjectStats,
  listProjects,
  recordIndexedFile,
  forgetProject,
};

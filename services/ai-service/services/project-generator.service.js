const config = require("../config");
const { streamGenerate } = require("./openrouter.service");
const {
  buildCoderPrompt,
  buildFixerPrompt,
  buildPlannerPrompt,
  buildReviewerPrompt,
} = require("./generation/prompts");
const {
  normalizeManifest,
  toProjectPath,
  validateProjectManifest,
} = require("./generation/manifest-schema");
const { buildProjectGodot, buildSceneFiles } = require("./generation/scene-builder");
const { validateGeneratedProjectStatic } = require("./generation/static-validator");
const { validateWithGodotCli } = require("./generation/godot-cli-validator");
const { validateFreeRoleConfig } = require("./generation/model-roles");
const { requireString } = require("../utils/validation");
const { logger } = require("../utils/logger");

const TEXT_FILE_EXTENSIONS = new Set([
  ".gd",
  ".gdshader",
  ".shader",
  ".tres",
  ".res",
  ".godot",
  ".cfg",
  ".ini",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".cs",
]);

const DEFAULT_TARGET_GODOT_VERSION = "4.6";
const MAX_PROMPT_ATTACHMENTS = 6;
const MAX_ATTACHMENT_DATA_URL_BYTES = 7 * 1024 * 1024;

const normalizePath = (filePath = "") =>
  toProjectPath(filePath).replace(/\\/g, "/").replace(/^\/+/, "");

const getExtension = (filePath = "") => {
  const normalized = normalizePath(filePath).toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index === -1 ? "" : normalized.slice(index);
};

const sanitizeProjectName = (name = "") => {
  const cleaned = String(name)
    .replace(/[^a-zA-Z0-9 _-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "Generated Godot Project";
};

const toTitleCase = (value = "") =>
  String(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^2d$/i.test(word)) return "2D";
      if (/^3d$/i.test(word)) return "3D";
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");

const slugProjectName = (prompt = "") => {
  const words = String(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word &&
        ![
          "a",
          "an",
          "are",
          "build",
          "create",
          "developer",
          "expert",
          "game",
          "generate",
          "godot",
          "make",
          "project",
          "style",
          "using",
          "you",
        ].includes(word)
    )
    .slice(0, 4);

  if (!words.length) return "Generated Godot Project";
  return toTitleCase(words.join(" "));
};

const deriveProjectName = ({ prompt = "", manifest } = {}) => {
  const promptText = String(prompt).toLowerCase();
  const gameType = String(manifest?.game_type || "").trim();
  const normalizedGameType = gameType.toLowerCase();

  if (promptText.includes("tetris") || normalizedGameType.includes("tetris")) {
    return "Tetris";
  }

  if (/\bflappy\s+bird\b/.test(promptText) || /\bflappy\s+bird\b/i.test(gameType)) {
    return "Flappy Bird Clone";
  }

  if (/\b(outer\s+space|space|spaceship|starship)\b/.test(promptText) && /\b(shoot|shooter|bullet|enemy|fighter)\b/.test(promptText)) {
    return "Space Fighter Shooter";
  }

  if (gameType && !/^(game|2d game|3d game)$/i.test(gameType)) {
    return sanitizeProjectName(toTitleCase(gameType.replace(/\b(godot|game|project)\b/gi, " ")));
  }

  return sanitizeProjectName(slugProjectName(prompt));
};

const toJsonText = (raw = "") => {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : raw).trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return candidate;
  }

  return candidate.slice(firstBrace, lastBrace + 1);
};

const quoteGodotConstructorValues = (jsonText = "") => {
  const constructors = [
    "Vector2",
    "Vector2i",
    "Vector3",
    "Vector3i",
    "Vector4",
    "Vector4i",
    "Color",
    "Rect2",
    "Rect2i",
    "Transform2D",
  ];
  const names = constructors.join("|");
  let text = jsonText;
  let changed = false;
  const pattern = new RegExp(`:\\s*(${names})\\(([^\\n\\r{}\\[\\]]*)\\)(\\s*[,}\\]])`, "g");

  text = text.replace(pattern, (_match, name, args, suffix) => {
    changed = true;
    const literal = `${name}(${String(args).replace(/"/g, '\\"')})`;
    return `: "${literal}"${suffix}`;
  });

  return { text, changed };
};

const parseJsonObject = (raw = "") => {
  const jsonText = toJsonText(raw);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const repaired = quoteGodotConstructorValues(jsonText);
    if (!repaired.changed) throw error;

    try {
      return JSON.parse(repaired.text);
    } catch {
      throw error;
    }
  }
};

const isValidGeneratedFilePath = (filePath = "") => {
  const normalized = normalizePath(filePath);
  if (!normalized || normalized.startsWith(".") || normalized.includes("../")) return false;
  if (normalized.endsWith(".tscn")) return false;
  return TEXT_FILE_EXTENSIONS.has(getExtension(normalized));
};

const normalizeAssets = (assets = []) =>
  (Array.isArray(assets) ? assets : [])
    .map((asset) => ({
      name: String(asset?.name || "").trim(),
      extension: String(asset?.extension || "").trim(),
      size: Number(asset?.size || 0),
      width: Number(asset?.width || 0),
      height: Number(asset?.height || 0),
      destinationPath: normalizePath(asset?.destinationPath || ""),
    }))
    .filter((asset) => asset.name && asset.destinationPath)
    .slice(0, 80);

const normalizeAttachments = (attachments = []) =>
  (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => ({
      name: String(attachment?.name || "reference image").trim(),
      mimeType: String(attachment?.mimeType || "").trim(),
      size: Number(attachment?.size || 0),
      dataUrl: String(attachment?.dataUrl || "").trim(),
      width: Number(attachment?.width || 0),
      height: Number(attachment?.height || 0),
    }))
    .filter(
      (attachment) =>
        attachment.name &&
        attachment.mimeType.startsWith("image/") &&
        attachment.dataUrl.startsWith("data:image/") &&
        attachment.dataUrl.length <= MAX_ATTACHMENT_DATA_URL_BYTES
    )
    .slice(0, MAX_PROMPT_ATTACHMENTS);

const summarizeAttachments = (attachments = []) =>
  attachments
    .map(
      (attachment) =>
        `- ${attachment.name} (${attachment.mimeType}, ${attachment.width || "?"}x${
          attachment.height || "?"
        }, ${attachment.size || 0} bytes)`
    )
    .join("\n");

const buildMultimodalMessages = ({ system, prompt, attachments }) => [
  {
    role: "system",
    content:
      system ||
      "You are a senior Godot engineer. Be precise, practical, and code-first.",
  },
  {
    role: "user",
    content: [
      {
        type: "text",
        text: prompt,
      },
      ...attachments.map((attachment) => ({
        type: "image_url",
        image_url: {
          url: attachment.dataUrl,
        },
      })),
    ],
  },
];

const emitProgress = (onProgress, event) => {
  const payload = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  logger.info("Godot generation progress", {
    stage: payload.stage,
    message: payload.message,
    role: payload.role,
    model: payload.model,
  });
  onProgress?.(payload);
};

const makeModelClient = ({ onModelSwitch, streamer = streamGenerate } = {}) => ({
  async generateJson({ role, prompt, system, attachments = [] }) {
    const promptAttachments = normalizeAttachments(attachments);
    const shouldUseVision = role === "planner" && promptAttachments.length > 0;
    let usedMetadataFallback = false;
    const streamJson = async ({ streamPrompt, messages, models }) => {
      let output = "";
      const result = await streamer({
        role,
        prompt: streamPrompt,
        system,
        messages,
        models,
        onModelSwitch,
        onToken: (token) => {
          output += token;
        },
      });

      return { output, result };
    };
    const retryWithMetadata = async ({ reason }) => {
      usedMetadataFallback = true;
      logger.warn("Vision planner returned unusable JSON; retrying with attachment metadata", {
        message: reason,
      });
      return streamJson({
        streamPrompt: `${prompt}\n\nAttached visual reference metadata:\n${summarizeAttachments(
          promptAttachments
        )}\n\nThe image route failed or returned incomplete JSON, so infer layout intent from the user's text and metadata if pixel inspection is unavailable. Return one complete strict JSON object.`,
      });
    };
    let streamResult;

    try {
      streamResult = await streamJson({
        streamPrompt: prompt,
        messages: shouldUseVision
          ? buildMultimodalMessages({ system, prompt, attachments: promptAttachments })
          : undefined,
        models: shouldUseVision ? config.openRouter.imagePlannerModels : undefined,
      });
    } catch (error) {
      if (!shouldUseVision) throw error;

      streamResult = await retryWithMetadata({
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    let json;
    try {
      json = parseJsonObject(streamResult.output);
    } catch (error) {
      if (!shouldUseVision || usedMetadataFallback) throw error;
      streamResult = await retryWithMetadata({
        reason: error instanceof Error ? error.message : String(error),
      });
      json = parseJsonObject(streamResult.output);
    }

    return {
      json,
      raw: streamResult.output,
      model: streamResult.result?.model || "",
      finishReason: streamResult.result?.finishReason || null,
    };
  },
});

const normalizeModelFiles = (files = []) => {
  const normalizedFiles = [];
  const seen = new Set();

  (Array.isArray(files) ? files : []).forEach((file) => {
    const filePath = normalizePath(file?.path || "");
    if (!isValidGeneratedFilePath(filePath) || seen.has(filePath)) return;
    if (typeof file?.content !== "string") return;

    seen.add(filePath);
    normalizedFiles.push({
      path: filePath,
      content: file.content.replace(/\r\n/g, "\n"),
    });
  });

  return normalizedFiles;
};

const upsertFile = (files, file) => {
  const filePath = normalizePath(file.path);
  const nextFile = {
    path: filePath,
    content: String(file.content || "").replace(/\r\n/g, "\n"),
  };
  const index = files.findIndex((entry) => normalizePath(entry.path) === filePath);

  if (index === -1) {
    files.push(nextFile);
  } else {
    files[index] = nextFile;
  }
};

const makeScriptStub = ({ script, prompt }) => {
  const extendsType = script.extends || "Node";
  return `extends ${extendsType}

# Generated safety stub. The coder role did not provide this required script.

func _ready() -> void:
\tprint("${deriveProjectName({ prompt }).replace(/"/g, "'")} ready")
`;
};

const makeReadme = ({ projectName, prompt, notes }) => `# ${projectName}

Generated by Godot Assistant for Godot 4.6.x.

Prompt:

> ${prompt}

Open this folder with Godot 4.6.x and run the configured main scene.

${notes.length ? `Notes:\n\n${notes.map((note) => `- ${note}`).join("\n")}\n` : ""}
`;

const extractResPaths = (content = "") =>
  Array.from(String(content).matchAll(/res:\/\/[A-Za-z0-9_./@ -]+/g)).map((match) =>
    match[0].replace(/[",')\]}]+$/, "")
  );

const titleFromPath = (filePath = "") => {
  const stem = normalizePath(filePath)
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "") || "GeneratedNode";
  const title = stem
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return title || "GeneratedNode";
};

const inferScriptPathForScene = ({ scenePath, files }) => {
  const stem = normalizePath(scenePath)
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .toLowerCase();
  if (!stem) return undefined;

  const script = files.find((file) => {
    const normalized = normalizePath(file.path).toLowerCase();
    return normalized === `scripts/${stem}.gd` || normalized.endsWith(`/${stem}.gd`);
  });

  return script ? `res://${normalizePath(script.path)}` : undefined;
};

const addPlaceholderScenesForMissingSceneReferences = ({
  manifest,
  files,
  assetPaths,
  buildWarnings,
  buildErrors,
}) => {
  const filePaths = new Set(files.map((file) => normalizePath(file.path)));
  const manifestScenePaths = new Set(manifest.scenes.map((scene) => normalizePath(scene.path)));
  const referencedScenePaths = new Set();

  files.forEach((file) => {
    const filePath = normalizePath(file.path);
    if (/\.(md|markdown|txt)$/i.test(filePath)) return;
    extractResPaths(file.content).forEach((resPath) => {
      const projectPath = normalizePath(resPath);
      if (projectPath.endsWith("/") || !projectPath.endsWith(".tscn")) return;
      if (!projectPath.startsWith("scenes/")) return;
      if (filePaths.has(projectPath) || manifestScenePaths.has(projectPath)) return;
      referencedScenePaths.add(projectPath);
    });
  });

  referencedScenePaths.forEach((scenePath) => {
    const script = inferScriptPathForScene({ scenePath, files });
    const scene = {
      path: `res://${scenePath}`,
      root: {
        type: "Node2D",
        name: titleFromPath(scenePath),
        ...(script ? { script } : {}),
        children: [],
      },
    };
    const sceneBuild = buildSceneFiles({
      manifest: {
        ...manifest,
        scenes: [scene],
      },
      assetPaths,
    });

    buildErrors.push(...sceneBuild.errors);
    sceneBuild.files.forEach((file) => upsertFile(files, file));
    filePaths.add(scenePath);
    buildWarnings.push({
      code: "placeholder_scene_created",
      message: `Created deterministic placeholder scene for ${scenePath}`,
    });
  });
};

const mergeSceneManifest = ({ manifest, sceneManifest, targetGodotVersion }) => {
  if (!sceneManifest || typeof sceneManifest !== "object") return manifest;
  return normalizeManifest(
    {
      ...manifest,
      ...sceneManifest,
      godot_version: sceneManifest.godot_version || manifest.godot_version,
      main_scene: sceneManifest.main_scene || manifest.main_scene,
      inputs: sceneManifest.inputs || manifest.inputs,
      autoloads: sceneManifest.autoloads || manifest.autoloads,
      assets: sceneManifest.assets || manifest.assets,
      scenes: sceneManifest.scenes || manifest.scenes,
      scripts: sceneManifest.scripts || manifest.scripts,
      validation_expectations:
        sceneManifest.validation_expectations || manifest.validation_expectations,
    },
    targetGodotVersion
  );
};

const buildGeneratedProjectFiles = ({
  manifest,
  coderOutput = {},
  projectName,
  prompt,
  assets,
  targetGodotVersion,
}) => {
  const notes = Array.isArray(coderOutput.notes) ? coderOutput.notes.map(String) : [];
  const assetPaths = assets.map((asset) => asset.destinationPath).filter(Boolean);
  const effectiveManifest = mergeSceneManifest({
    manifest,
    sceneManifest: coderOutput.scene_manifest,
    targetGodotVersion,
  });
  const files = normalizeModelFiles(coderOutput.files);
  const buildErrors = [];
  const buildWarnings = [];
  const manifestValidation = validateProjectManifest(effectiveManifest, {
    targetGodotVersion,
    assetPaths,
  });

  buildErrors.push(...manifestValidation.errors);

  effectiveManifest.scripts.forEach((script) => {
    const scriptPath = normalizePath(script.path);
    if (!files.some((file) => normalizePath(file.path) === scriptPath)) {
      files.push({
        path: scriptPath,
        content: makeScriptStub({ script, prompt }),
      });
      buildWarnings.push({
        code: "script_stub_created",
        message: `Created a fallback stub for ${script.path}`,
      });
    }
  });

  const projectFile = buildProjectGodot({ manifest: effectiveManifest, projectName });
  upsertFile(files, projectFile);
  buildWarnings.push(...projectFile.warnings);

  const sceneBuild = buildSceneFiles({ manifest: effectiveManifest, assetPaths });
  buildErrors.push(...sceneBuild.errors);
  sceneBuild.files.forEach((file) => upsertFile(files, file));

  addPlaceholderScenesForMissingSceneReferences({
    manifest: effectiveManifest,
    files,
    assetPaths,
    buildWarnings,
    buildErrors,
  });

  if (!files.some((file) => normalizePath(file.path) === "README.md")) {
    files.push({
      path: "README.md",
      content: makeReadme({ projectName, prompt, notes }),
    });
  }

  return {
    manifest: effectiveManifest,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    notes,
    buildErrors,
    buildWarnings,
  };
};

const runValidation = async ({
  manifest,
  files,
  assets,
  buildErrors = [],
  buildWarnings = [],
  options,
}) => {
  if (options.validationEnabled === false) {
    return {
      ok: true,
      static_errors: [],
      cli_errors: [],
      warnings: ["Validation was disabled for this generation request."],
    };
  }

  const assetPaths = assets.map((asset) => asset.destinationPath).filter(Boolean);
  const staticResult = validateGeneratedProjectStatic({ manifest, files, assetPaths });
  const cliResult = await validateWithGodotCli({
    projectPath: options.projectPath || config.godot.projectPath,
    mainScene: manifest.main_scene,
    enabled: options.cliValidationEnabled,
  });

  return {
    ok: buildErrors.length === 0 && staticResult.ok && cliResult.ok,
    static_errors: [...buildErrors, ...staticResult.static_errors],
    cli_errors: cliResult.cli_errors,
    warnings: [
      ...buildWarnings.map((warning) =>
        typeof warning === "string" ? warning : warning.message || String(warning.code)
      ),
      ...staticResult.warnings,
      ...cliResult.warnings,
    ],
    cli_runs: cliResult.runs,
  };
};

const collectAffectedFiles = ({ files, validation, review }) => {
  const affectedPaths = new Set();
  const combined = [
    ...(validation?.static_errors || []),
    ...(validation?.cli_errors || []).map((message) => ({ message })),
    ...(review?.issues || []),
  ];

  combined.forEach((issue) => {
    if (issue.file) affectedPaths.add(normalizePath(issue.file));
    const text = JSON.stringify(issue);
    for (const match of text.matchAll(/res:\/\/[A-Za-z0-9_./@ -]+/g)) {
      affectedPaths.add(normalizePath(match[0].replace(/[",')\]}]+$/, "")));
    }
  });

  const affected = files.filter((file) => affectedPaths.has(normalizePath(file.path)));
  return (affected.length ? affected : files).slice(0, 12);
};

const shouldRepair = ({ validation, review }) =>
  !validation.ok || (review && review.approved === false);

const runReviewer = async ({
  aiClient,
  manifest,
  files,
  targetGodotVersion,
  logs,
  modelUsage,
  onProgress,
}) => {
  try {
    emitProgress(onProgress, {
      stage: "review",
      role: "reviewer",
      message: "Reviewing generated files",
    });
    const response = await aiClient.generateJson({
      role: "reviewer",
      system: "You review generated Godot 4.6 projects and return strict JSON only.",
      prompt: buildReviewerPrompt({
        plan: manifest,
        files,
        targetGodotVersion,
      }),
    });
    modelUsage.reviewer = response.model || modelUsage.reviewer;
    return {
      approved: Boolean(response.json?.approved),
      issues: Array.isArray(response.json?.issues) ? response.json.issues : [],
      suggested_fixes: Array.isArray(response.json?.suggested_fixes)
        ? response.json.suggested_fixes
        : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.push(`Reviewer unavailable: ${message}`);
    logger.warn("Godot project reviewer failed", { message });
    return {
      approved: true,
      issues: [],
      suggested_fixes: [],
      skipped: true,
      warning: message,
    };
  }
};

const applyFixerOutput = ({ files, manifest, fixerOutput, targetGodotVersion }) => {
  let nextManifest = manifest;
  const notes = Array.isArray(fixerOutput.notes) ? fixerOutput.notes.map(String) : [];

  if (fixerOutput.scene_manifest) {
    nextManifest = mergeSceneManifest({
      manifest,
      sceneManifest: fixerOutput.scene_manifest,
      targetGodotVersion,
    });
  }

  normalizeModelFiles(fixerOutput.files).forEach((file) => upsertFile(files, file));

  return { manifest: nextManifest, notes };
};

const generateProjectManifest = async ({
  prompt,
  assets = [],
  attachments = [],
  options = {},
  aiClient,
  onProgress,
}) => {
  const validPrompt = requireString(prompt, "prompt");
  const normalizedAssets = normalizeAssets(assets);
  const normalizedAttachments = normalizeAttachments(attachments);
  const targetGodotVersion = String(
    options.targetGodotVersion || config.godot.targetVersion || DEFAULT_TARGET_GODOT_VERSION
  );
  const repairIterations = Math.max(
    0,
    Number(options.repairIterations ?? config.godot.repairIterations ?? 2)
  );
  const logs = [];
  const modelUsage = {};
  const client =
    aiClient ||
    makeModelClient({
      onModelSwitch: (event) =>
        emitProgress(onProgress, {
          stage: "model-switch",
          message: `Free model switched from ${event.from} to ${event.to}`,
          from: event.from,
          to: event.to,
        }),
    });

  const roleConfig = validateFreeRoleConfig();
  if (!roleConfig.ok) {
    const error = new Error(`OpenRouter role config must use free models only: ${roleConfig.errors.join("; ")}`);
    error.statusCode = 500;
    throw error;
  }

  let projectName = deriveProjectName({ prompt: validPrompt });
  const baseOptions = {
    mode: options.mode || "free",
    validationEnabled: options.validationEnabled !== false,
    cliValidationEnabled: options.cliValidationEnabled ?? config.godot.enableCliValidation,
    projectPath: options.projectPath || "",
  };

  emitProgress(onProgress, {
    stage: "plan",
    role: "planner",
    message: normalizedAttachments.length
      ? "Planning Godot 4.6 project manifest with visual references"
      : "Planning Godot 4.6 project manifest",
  });
  const plannerResponse = await client.generateJson({
    role: "planner",
    system: "You plan Godot 4.6 projects and return strict JSON only.",
    prompt: buildPlannerPrompt({
      userRequest: validPrompt,
      targetGodotVersion,
      assets: normalizedAssets,
      attachments: normalizedAttachments,
      constraints: [
        "Use only Godot 4.6.x APIs.",
        "Represent scenes as manifest JSON.",
        "Do not ask the model to hand-write raw .tscn unless unavoidable.",
        "Use only the provided res:// asset paths.",
        "Use prompt attachments as visual references only unless the user also added them as project assets.",
      ],
    }),
    attachments: normalizedAttachments,
  });
  modelUsage.planner = plannerResponse.model || "";
  emitProgress(onProgress, {
    stage: "plan",
    role: "planner",
    model: modelUsage.planner,
    message: "Planner returned a project manifest",
  });

  const planValidation = validateProjectManifest(plannerResponse.json, {
    targetGodotVersion,
    assetPaths: normalizedAssets.map((asset) => asset.destinationPath).filter(Boolean),
  });
  if (!planValidation.ok) {
    const error = new Error(
      `Planner returned an invalid Godot 4.6 manifest: ${planValidation.errors
        .map((issue) => issue.message)
        .join("; ")}`
    );
    error.statusCode = 502;
    error.validation = {
      ok: false,
      static_errors: planValidation.errors,
      cli_errors: [],
      warnings: [],
    };
    throw error;
  }

  let manifest = planValidation.manifest;
  projectName = deriveProjectName({ prompt: validPrompt, manifest });
  emitProgress(onProgress, {
    stage: "code",
    role: "coder",
    message: "Generating GDScript and support files",
  });
  const coderResponse = await client.generateJson({
    role: "coder",
    system: "You generate Godot 4.6 GDScript files and return strict JSON only.",
    prompt: buildCoderPrompt({
      plan: manifest,
      targetGodotVersion,
    }),
  });
  modelUsage.coder = coderResponse.model || "";
  emitProgress(onProgress, {
    stage: "code",
    role: "coder",
    model: modelUsage.coder,
    message: "Coder returned project files",
  });

  emitProgress(onProgress, {
    stage: "build-scenes",
    message: "Building deterministic Godot scenes",
  });
  let generated = buildGeneratedProjectFiles({
    manifest,
    coderOutput: coderResponse.json,
    projectName,
    prompt: validPrompt,
    assets: normalizedAssets,
    targetGodotVersion,
  });
  manifest = generated.manifest;

  emitProgress(onProgress, {
    stage: "validate",
    message: "Running static validation",
  });
  let validation = await runValidation({
    manifest,
    files: generated.files,
    assets: normalizedAssets,
    buildErrors: generated.buildErrors,
    buildWarnings: generated.buildWarnings,
    options: baseOptions,
  });
  let review = await runReviewer({
    aiClient: client,
    manifest,
    files: generated.files,
    targetGodotVersion,
    logs,
    modelUsage,
    onProgress,
  });

  const notes = [...generated.notes];
  let iterations = 0;
  while (iterations < repairIterations && shouldRepair({ validation, review })) {
    iterations += 1;
    logs.push(`Repair iteration ${iterations} started.`);
    emitProgress(onProgress, {
      stage: "repair",
      role: "fixer",
      message: `Repair pass ${iterations} of ${repairIterations}`,
      iteration: iterations,
      maxIterations: repairIterations,
    });
    const affectedFiles = collectAffectedFiles({
      files: generated.files,
      validation,
      review,
    });

    let fixerResponse;
    try {
      fixerResponse = await client.generateJson({
        role: "fixer",
        system: "You repair Godot 4.6 generated projects and return strict JSON only.",
        prompt: buildFixerPrompt({
          plan: manifest,
          files: affectedFiles,
          validation: {
            ...validation,
            review,
          },
          targetGodotVersion,
        }),
      });
      modelUsage.fixer = fixerResponse.model || modelUsage.fixer;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logs.push(`Fixer unavailable: ${message}`);
      logger.warn("Godot project fixer failed", { message });
      break;
    }

    const fixed = applyFixerOutput({
      files: generated.files,
      manifest,
      fixerOutput: fixerResponse.json,
      targetGodotVersion,
    });
    manifest = fixed.manifest;
    notes.push(...fixed.notes);

    generated = buildGeneratedProjectFiles({
      manifest,
      coderOutput: {
        files: generated.files,
        notes,
      },
      projectName,
      prompt: validPrompt,
      assets: normalizedAssets,
      targetGodotVersion,
    });
    manifest = generated.manifest;

    validation = await runValidation({
      manifest,
      files: generated.files,
      assets: normalizedAssets,
      buildErrors: generated.buildErrors,
      buildWarnings: generated.buildWarnings,
      options: baseOptions,
    });
    review = await runReviewer({
      aiClient: client,
      manifest,
      files: generated.files,
      targetGodotVersion,
      logs,
      modelUsage,
      onProgress,
    });
  }

  if (shouldRepair({ validation, review })) {
    logs.push(`Repair stopped after ${iterations} iteration(s).`);
  } else {
    logs.push(`Validation passed after ${iterations} repair iteration(s).`);
  }

  emitProgress(onProgress, {
    stage: "done",
    message: shouldRepair({ validation, review })
      ? "Generation finished with validation issues"
      : "Generation passed validation",
  });

  return {
    projectName,
    summary: `Generated ${manifest.game_type || "Godot"} project for Godot ${targetGodotVersion}.x.`,
    mainScene: toProjectPath(manifest.main_scene),
    files: generated.files,
    notes: Array.from(new Set(notes)).slice(0, 12),
    model: modelUsage.coder || modelUsage.planner || "",
    models: modelUsage,
    usedFallback: false,
    success: !shouldRepair({ validation, review }),
    mode: "free",
    targetGodotVersion,
    plan: manifest,
    review,
    validation,
    repairIterationsUsed: iterations,
    logs,
  };
};

module.exports = {
  buildGeneratedProjectFiles,
  deriveProjectName,
  generateProjectManifest,
  makeModelClient,
  normalizeAssets,
  parseJsonObject,
};

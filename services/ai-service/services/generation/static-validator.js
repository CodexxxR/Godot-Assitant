const { collectSceneScriptPaths, normalizeResPath, toProjectPath } = require("./manifest-schema");

const normalizeFilePath = (filePath = "") => toProjectPath(filePath);

const toFileMap = (files = []) =>
  new Map(
    files.map((file) => [
      normalizeFilePath(file.path),
      {
        path: normalizeFilePath(file.path),
        content: String(file.content || ""),
      },
    ])
  );

const getFile = (fileMap, path) => fileMap.get(normalizeFilePath(path));

const extractMainSceneFromProject = (content = "") => {
  const match = content.match(/run\/main_scene\s*=\s*"([^"]+)"/);
  return match?.[1] || "";
};

const validateTscnExtResourceOrder = ({ file }) => {
  const errors = [];
  const defined = new Set();
  const used = new Set();
  const lines = String(file.content || "").split(/\r?\n/);

  lines.forEach((line, index) => {
    const extMatch = line.match(/^\s*\[ext_resource\b[^\]]*\bid="([^"]+)"/);
    if (extMatch) defined.add(extMatch[1]);

    for (const usage of line.matchAll(/ExtResource\("([^"]+)"\)/g)) {
      const id = usage[1];
      used.add(id);
      if (!defined.has(id)) {
        errors.push({
          code: "ext_resource_used_before_definition",
          message: `${file.path} uses ExtResource("${id}") before its definition on line ${index + 1}`,
          file: file.path,
          line: index + 1,
        });
      }
    }
  });

  used.forEach((id) => {
    if (!defined.has(id)) {
      errors.push({
        code: "ext_resource_never_defined",
        message: `${file.path} uses ExtResource("${id}") but never defines it`,
        file: file.path,
      });
    }
  });

  return errors;
};

const extractResPaths = (content = "") =>
  Array.from(content.matchAll(/res:\/\/[A-Za-z0-9_./@ -]+/g)).map((match) =>
    match[0].replace(/[",')\]}]+$/, "")
  );

const shouldValidateResPathsInFile = (filePath = "") =>
  !/\.(md|markdown|txt)$/i.test(filePath);

const isImageAssetPath = (filePath = "") => /\.(png|jpe?g|webp|bmp|gif|svg|ico)$/i.test(filePath);

const looksLikeGridGameplayScript = (content = "") => {
  const text = String(content).toLowerCase();
  return (
    /\b(board_width|board_height|cell_size|grid_size|tile_size)\b/i.test(content) ||
    (/\b(grid|board|tile|cell)\b/.test(text) &&
      /\b(collision|collide|valid_position|is_valid|lock|clear|spawn|move|rotate)\b/.test(text))
  );
};

const hasIntegerGridState = (content = "") =>
  /\bVector2i\b|\bPackedVector2Array\b|\bgrid_position\b|\bgrid_pos\b|\bboard_cell\b|\bcell_position\b/.test(
    content
  );

const hasExplicitAssetLayoutPolicy = (content = "") =>
  /\bAtlasTexture\b|\bregion_enabled\b|\bregion_rect\b|\bdraw_texture_rect_region\b|\.scale\s*=|\bscale\s*=|\bset_size\s*\(|\bcustom_minimum_size\b|\bstretch_mode\b|\btexture_filter\b|\bget_width\s*\(|\bget_height\s*\(|\bCELL_SIZE\b|\bTILE_SIZE\b|\bGRID_SIZE\b/i.test(
    content
  );

const validateGameplayScriptHeuristics = ({ normalizedPath, content, referencedImageAssets }) => {
  const errors = [];

  if (normalizedPath.endsWith(".gd") && /^\s*onready\b/m.test(content)) {
    errors.push({
      code: "legacy_onready_syntax",
      message: `${normalizedPath} uses Godot 3-style onready syntax; use @onready var in Godot 4.x`,
      file: normalizedPath,
    });
  }

  if (normalizedPath.endsWith(".gd") && /^\s*@onready\s+func\b/m.test(content)) {
    errors.push({
      code: "invalid_onready_function",
      message: `${normalizedPath} uses @onready on a function; @onready is only valid for variables`,
      file: normalizedPath,
    });
  }

  if (normalizedPath.endsWith(".gd") && looksLikeGridGameplayScript(content) && !hasIntegerGridState(content)) {
    errors.push({
      code: "grid_game_without_integer_state",
      message: `${normalizedPath} appears to implement grid gameplay without integer grid state such as Vector2i; keep collision/state in grid coordinates and convert to pixels only when drawing`,
      file: normalizedPath,
    });
  }

  if (
    normalizedPath.endsWith(".gd") &&
    referencedImageAssets.length > 0 &&
    /\b(Sprite2D|TextureRect)\b/.test(content) &&
    !hasExplicitAssetLayoutPolicy(content)
  ) {
    errors.push({
      code: "asset_without_scale_policy",
      message: `${normalizedPath} uses image assets with Sprite2D/TextureRect but has no explicit scale, region, size, or dimension-based layout policy`,
      file: normalizedPath,
    });
  }

  if (
    normalizedPath.endsWith(".gd") &&
    /\bCELL_SIZE\b|\bTILE_SIZE\b|\bGRID_SIZE\b/i.test(content) &&
    /for\s+\w+\s+in\s+[^\n]*(cells|blocks|shape|piece|tiles)/i.test(content) &&
    /\bSprite2D\.new\s*\(\s*\)/.test(content) &&
    /\.texture\s*=/.test(content) &&
    !/\bAtlasTexture\b|\bregion_enabled\b|\bregion_rect\b|\bdraw_texture_rect_region\b/i.test(content)
  ) {
    errors.push({
      code: "full_texture_repeated_as_grid_cell",
      message: `${normalizedPath} appears to draw a full composite texture once per grid cell; crop with AtlasTexture/regions, draw cells procedurally, or render the composite as one sprite`,
      file: normalizedPath,
    });
  }

  if (
    normalizedPath.endsWith(".gd") &&
    /var\s+(\w+)\s*(?::=|=)\s*[A-Za-z0-9_]+\.new\s*\(\s*\)[\s\S]{0,1200}for\s+[\s\S]{0,800}add_child\s*\(\s*\1\s*\)/.test(
      content
    )
  ) {
    errors.push({
      code: "spawn_reuses_single_node_instance",
      message: `${normalizedPath} appears to add the same newly-created node inside a loop; spawners must create a fresh node instance for each entity`,
      file: normalizedPath,
    });
  }

  return errors;
};

const validateGeneratedProjectStatic = ({ manifest, files, assetPaths = [] }) => {
  const fileMap = toFileMap(files);
  const errors = [];
  const warnings = [];
  const assetPathSet = new Set(assetPaths.map((assetPath) => normalizeFilePath(assetPath)));
  const imageAssetPathSet = new Set(
    assetPaths
      .map((assetPath) => normalizeFilePath(assetPath))
      .filter((assetPath) => isImageAssetPath(assetPath))
  );

  if (!manifest.godot_version?.startsWith("4.6")) {
    errors.push({
      code: "wrong_godot_version",
      message: `Manifest targets Godot ${manifest.godot_version}; expected 4.6.x`,
    });
  }

  const projectFile = getFile(fileMap, "project.godot");
  if (!projectFile) {
    errors.push({
      code: "missing_project_godot",
      message: "project.godot is required",
    });
  } else {
    if (/PackedStringArray\("4\.2"\)|godot_version\s*[:=]\s*["']4\.2/i.test(projectFile.content)) {
      errors.push({
        code: "godot_42_target",
        message: "project.godot must not target Godot 4.2",
        file: "project.godot",
      });
    }

    const projectMainScene = extractMainSceneFromProject(projectFile.content);
    if (projectMainScene && normalizeResPath(projectMainScene) !== normalizeResPath(manifest.main_scene)) {
      errors.push({
        code: "project_main_scene_mismatch",
        message: `project.godot points to ${projectMainScene}, expected ${manifest.main_scene}`,
        file: "project.godot",
      });
    }
  }

  if (!getFile(fileMap, manifest.main_scene)) {
    errors.push({
      code: "missing_main_scene",
      message: `Main scene file is missing: ${manifest.main_scene}`,
    });
  }

  const scriptPaths = collectSceneScriptPaths(manifest.scenes);
  scriptPaths.forEach((scriptPath) => {
    if (!getFile(fileMap, scriptPath)) {
      errors.push({
        code: "missing_script_file",
        message: `Scene references missing script file ${scriptPath}`,
        file: toProjectPath(scriptPath),
      });
    }
  });

  files.forEach((file) => {
    const normalizedPath = normalizeFilePath(file.path);
    const content = String(file.content || "");

    if (/\bKinematicBody2D\b|\bSpatial\b|\bRigidBody\b(?!2D|3D)/.test(content)) {
      errors.push({
        code: "godot3_syntax",
        message: `${normalizedPath} contains likely Godot 3.x syntax`,
        file: normalizedPath,
      });
    }

    if (/Godot 4\.2|config\/features=PackedStringArray\("4\.2"\)/i.test(content)) {
      errors.push({
        code: "godot42_assumption",
        message: `${normalizedPath} contains a Godot 4.2 target or assumption`,
        file: normalizedPath,
      });
    }

    const referencedImageAssets = extractResPaths(content)
      .map((resPath) => normalizeFilePath(resPath))
      .filter((projectPath) => imageAssetPathSet.has(projectPath));

    errors.push(
      ...validateGameplayScriptHeuristics({
        normalizedPath,
        content,
        referencedImageAssets,
      })
    );

    if (normalizedPath.endsWith(".tscn")) {
      errors.push(...validateTscnExtResourceOrder({ file: { path: normalizedPath, content } }));
    }

    if (!shouldValidateResPathsInFile(normalizedPath)) return;

    extractResPaths(content).forEach((resPath) => {
      if (resPath.endsWith("/")) return;
      const projectPath = normalizeFilePath(resPath);
      if (projectPath === normalizedPath) return;
      if (fileMap.has(projectPath) || assetPathSet.has(projectPath)) return;
      if (resPath.startsWith("res://assets/")) {
        errors.push({
          code: "missing_asset_reference",
          message: `${normalizedPath} references missing asset ${resPath}`,
          file: normalizedPath,
        });
        return;
      }
      errors.push({
        code: "missing_res_path",
        message: `${normalizedPath} references missing path ${resPath}`,
        file: normalizedPath,
      });
    });
  });

  if (!projectFile) {
    warnings.push("Godot CLI validation cannot run until project.godot exists.");
  }

  return {
    ok: errors.length === 0,
    static_errors: errors,
    warnings,
  };
};

module.exports = {
  extractMainSceneFromProject,
  validateGeneratedProjectStatic,
  validateTscnExtResourceOrder,
};

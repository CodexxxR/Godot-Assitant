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

const validateGeneratedProjectStatic = ({ manifest, files, assetPaths = [] }) => {
  const fileMap = toFileMap(files);
  const errors = [];
  const warnings = [];
  const assetPathSet = new Set(assetPaths.map((assetPath) => normalizeFilePath(assetPath)));

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

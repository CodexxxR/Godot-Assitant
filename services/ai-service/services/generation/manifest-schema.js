const SUPPORTED_NODE_TYPES = new Set([
  "Node",
  "Node2D",
  "CharacterBody2D",
  "Area2D",
  "StaticBody2D",
  "RigidBody2D",
  "Sprite2D",
  "ColorRect",
  "Label",
  "Camera2D",
  "Timer",
  "CollisionShape2D",
  "Marker2D",
  "CanvasLayer",
]);

const normalizeSlashes = (value = "") => String(value).replace(/\\/g, "/");

const normalizeResPath = (value = "") => {
  const normalized = normalizeSlashes(value).trim();
  if (!normalized) return "";
  if (normalized.startsWith("res://")) return normalized;
  return `res://${normalized.replace(/^\/+/, "")}`;
};

const toProjectPath = (value = "") =>
  normalizeResPath(value).replace(/^res:\/\//, "").replace(/^\/+/, "");

const isValidResPath = (value = "") => {
  const normalized = normalizeResPath(value);
  if (!normalized.startsWith("res://")) return false;
  const path = toProjectPath(normalized);
  return Boolean(path && !path.includes("../") && !path.startsWith("."));
};

const normalizeInputEvent = (event = {}) => ({
  type: String(event.type || "").trim(),
  key: event.key ? String(event.key).trim().toUpperCase() : undefined,
  button: event.button ? String(event.button).trim().toUpperCase() : undefined,
});

const normalizeNode = (node = {}) => {
  const children = [
    ...(Array.isArray(node.children) ? node.children : []),
  ].map(normalizeNode);

  return {
    type: String(node.type || "Node2D").trim(),
    name: String(node.name || "Node").trim(),
    script: node.script ? normalizeResPath(node.script) : undefined,
    properties:
      node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)
        ? node.properties
        : {},
    children,
  };
};

const normalizeScene = (scene = {}) => {
  const root = normalizeNode(scene.root || {});
  const sceneChildren = Array.isArray(scene.children) ? scene.children.map(normalizeNode) : [];
  root.children = [...root.children, ...sceneChildren];

  return {
    path: normalizeResPath(scene.path || "res://scenes/Main.tscn"),
    root,
  };
};

const normalizeScript = (script = {}) => ({
  path: normalizeResPath(script.path || ""),
  extends: String(script.extends || "").trim(),
  purpose: String(script.purpose || "").trim(),
});

const normalizeManifest = (manifest = {}, targetGodotVersion = "4.6") => ({
  godot_version: String(manifest.godot_version || targetGodotVersion).trim(),
  game_type: String(manifest.game_type || "game").trim(),
  main_scene: normalizeResPath(manifest.main_scene || "res://scenes/Main.tscn"),
  inputs: Array.isArray(manifest.inputs)
    ? manifest.inputs.map((input) => ({
        name: String(input.name || "").trim(),
        events: Array.isArray(input.events) ? input.events.map(normalizeInputEvent) : [],
      }))
    : [],
  autoloads: Array.isArray(manifest.autoloads) ? manifest.autoloads : [],
  assets: Array.isArray(manifest.assets)
    ? manifest.assets.map((asset) => ({
        source_name: String(asset.source_name || asset.name || "").trim(),
        path: normalizeResPath(asset.path || ""),
        usage: String(asset.usage || "").trim(),
      }))
    : [],
  scenes: Array.isArray(manifest.scenes) ? manifest.scenes.map(normalizeScene) : [],
  scripts: Array.isArray(manifest.scripts) ? manifest.scripts.map(normalizeScript) : [],
  validation_expectations: Array.isArray(manifest.validation_expectations)
    ? manifest.validation_expectations.map(String)
    : [],
});

const validateNode = (node, scenePath, errors, path = "root") => {
  if (!node.name) {
    errors.push({
      code: "node_name_missing",
      message: `Node name is required in ${scenePath}`,
      path,
    });
  }

  if (!SUPPORTED_NODE_TYPES.has(node.type)) {
    errors.push({
      code: "unsupported_node_type",
      message: `Unsupported node type ${node.type} in ${scenePath}`,
      path,
    });
  }

  if (node.script && !isValidResPath(node.script)) {
    errors.push({
      code: "invalid_node_script_path",
      message: `Invalid script path ${node.script} in ${scenePath}`,
      path,
    });
  }

  node.children.forEach((child, index) =>
    validateNode(child, scenePath, errors, `${path}.children[${index}]`)
  );
};

const collectSceneScriptPaths = (scenes = []) => {
  const scriptPaths = new Set();
  const visit = (node) => {
    if (node.script) scriptPaths.add(normalizeResPath(node.script));
    node.children.forEach(visit);
  };
  scenes.forEach((scene) => visit(scene.root));
  return scriptPaths;
};

const validateProjectManifest = (manifest = {}, options = {}) => {
  const targetGodotVersion = options.targetGodotVersion || "4.6";
  const normalized = normalizeManifest(manifest, targetGodotVersion);
  const errors = [];
  const requiredFields = [
    "godot_version",
    "game_type",
    "main_scene",
    "inputs",
    "autoloads",
    "assets",
    "scenes",
    "scripts",
    "validation_expectations",
  ];

  requiredFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(manifest, field)) {
      errors.push({
        code: "missing_manifest_field",
        message: `Manifest must include ${field}`,
        path: field,
      });
    }
  });

  if (!normalized.godot_version.startsWith("4.6")) {
    errors.push({
      code: "wrong_godot_version",
      message: `Manifest targets Godot ${normalized.godot_version}; expected 4.6.x`,
      path: "godot_version",
    });
  }

  if (!isValidResPath(normalized.main_scene)) {
    errors.push({
      code: "invalid_main_scene",
      message: "main_scene must be a valid res:// path",
      path: "main_scene",
    });
  }

  if (normalized.scenes.length === 0) {
    errors.push({
      code: "missing_scenes",
      message: "At least one scene manifest is required",
      path: "scenes",
    });
  }

  const scenePaths = new Set(normalized.scenes.map((scene) => normalizeResPath(scene.path)));
  if (!scenePaths.has(normalized.main_scene)) {
    errors.push({
      code: "missing_main_scene_manifest",
      message: `Main scene ${normalized.main_scene} is not present in scenes`,
      path: "main_scene",
    });
  }

  const scriptPaths = new Set(normalized.scripts.map((script) => normalizeResPath(script.path)));
  collectSceneScriptPaths(normalized.scenes).forEach((scriptPath) => {
    if (!scriptPaths.has(scriptPath)) {
      errors.push({
        code: "missing_script_manifest",
        message: `Scene references script ${scriptPath}, but scripts does not include it`,
        path: "scripts",
      });
    }
  });

  normalized.scenes.forEach((scene, index) => {
    if (!isValidResPath(scene.path) || !scene.path.endsWith(".tscn")) {
      errors.push({
        code: "invalid_scene_path",
        message: `Scene path must be a valid .tscn res:// path: ${scene.path}`,
        path: `scenes[${index}].path`,
      });
    }
    validateNode(scene.root, scene.path, errors, `scenes[${index}].root`);
  });

  normalized.scripts.forEach((script, index) => {
    if (!isValidResPath(script.path) || !script.path.endsWith(".gd")) {
      errors.push({
        code: "invalid_script_path",
        message: `Script path must be a valid .gd res:// path: ${script.path}`,
        path: `scripts[${index}].path`,
      });
    }
    if (!script.extends) {
      errors.push({
        code: "script_extends_missing",
        message: `Script ${script.path} must declare an extends target`,
        path: `scripts[${index}].extends`,
      });
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    manifest: normalized,
  };
};

module.exports = {
  SUPPORTED_NODE_TYPES,
  collectSceneScriptPaths,
  normalizeManifest,
  normalizeResPath,
  toProjectPath,
  validateProjectManifest,
};

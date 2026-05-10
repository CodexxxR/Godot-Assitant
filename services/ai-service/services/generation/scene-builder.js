const { toProjectPath } = require("./manifest-schema");

const KEYCODES = {
  SPACE: 32,
  ENTER: 4194309,
  ESCAPE: 4194305,
  LEFT: 4194319,
  UP: 4194320,
  RIGHT: 4194321,
  DOWN: 4194322,
  A: 65,
  B: 66,
  C: 67,
  D: 68,
  E: 69,
  F: 70,
  G: 71,
  H: 72,
  I: 73,
  J: 74,
  K: 75,
  L: 76,
  M: 77,
  N: 78,
  O: 79,
  P: 80,
  Q: 81,
  R: 82,
  S: 83,
  T: 84,
  U: 85,
  V: 86,
  W: 87,
  X: 88,
  Y: 89,
  Z: 90,
};

const MOUSE_BUTTONS = {
  LEFT: 1,
  RIGHT: 2,
  MIDDLE: 3,
};

const quote = (value = "") => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const resourceIdForPath = (index, resourcePath) => {
  const stem = toProjectPath(resourcePath)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return `${index}_${stem || "resource"}`;
};

const inferResourceType = (resourcePath = "") => {
  if (resourcePath.endsWith(".gd")) return "Script";
  if (/\.(png|jpg|jpeg|webp|bmp|gif|svg)$/i.test(resourcePath)) return "Texture2D";
  if (/\.(tres|res)$/i.test(resourcePath)) return "Resource";
  return "Resource";
};

const collectResourceRefs = ({ scene, availableAssetPaths, errors }) => {
  const resourceRefs = new Set();

  const addResource = (resourcePath, pathContext) => {
    if (!resourcePath || !String(resourcePath).startsWith("res://")) return;
    if (resourcePath.startsWith("res://assets/") && !availableAssetPaths.has(resourcePath)) {
      errors.push({
        code: "unknown_asset_reference",
        message: `Scene references unavailable asset ${resourcePath}`,
        path: pathContext,
      });
      return;
    }
    resourceRefs.add(resourcePath);
  };

  const visit = (node, pathContext) => {
    addResource(node.script, `${pathContext}.script`);
    Object.entries(node.properties || {}).forEach(([key, value]) => {
      if (typeof value === "string" && value.startsWith("res://")) {
        addResource(value, `${pathContext}.properties.${key}`);
      }
    });
    node.children.forEach((child, index) => visit(child, `${pathContext}.children[${index}]`));
  };

  visit(scene.root, "root");
  return Array.from(resourceRefs).sort();
};

const serializeValue = ({ value, resourceIds, errors, path }) => {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (value.startsWith("res://")) {
      const resourceId = resourceIds.get(value);
      if (!resourceId) {
        errors.push({
          code: "missing_ext_resource_for_property",
          message: `No ext_resource generated for ${value}`,
          path,
        });
        return '""';
      }
      return `ExtResource("${resourceId}")`;
    }
    if (/^Color\(|^Vector[234][i]?\(/.test(value)) return value;
    return `"${quote(value)}"`;
  }
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((entry) => typeof entry === "number")) {
      return `Vector2(${value[0]}, ${value[1]})`;
    }
    if (value.length === 4 && value.every((entry) => typeof entry === "number")) {
      return `Color(${value.join(", ")})`;
    }
  }
  if (value && typeof value === "object") {
    if (value.type === "Vector2") return `Vector2(${Number(value.x || 0)}, ${Number(value.y || 0)})`;
    if (value.type === "Color") {
      return `Color(${Number(value.r || 0)}, ${Number(value.g || 0)}, ${Number(value.b || 0)}, ${Number(value.a ?? 1)})`;
    }
  }

  errors.push({
    code: "unsupported_property_value",
    message: `Unsupported property value at ${path}`,
    path,
  });
  return "null";
};

const nodeHeader = ({ node, parentPath }) => {
  const parts = [`name="${quote(node.name)}"`, `type="${quote(node.type)}"`];
  if (parentPath) parts.push(`parent="${quote(parentPath)}"`);
  return `[node ${parts.join(" ")}]`;
};

const renderNode = ({ node, parentPath, nodePath, resourceIds, errors }) => {
  const lines = [nodeHeader({ node, parentPath })];

  if (node.script) {
    const scriptId = resourceIds.get(node.script);
    if (!scriptId) {
      errors.push({
        code: "missing_script_ext_resource",
        message: `No ext_resource generated for ${node.script}`,
        path: nodePath,
      });
    } else {
      lines.push(`script = ExtResource("${scriptId}")`);
    }
  }

  Object.entries(node.properties || {}).forEach(([key, value]) => {
    if (key === "script") return;
    lines.push(
      `${key} = ${serializeValue({
        value,
        resourceIds,
        errors,
        path: `${nodePath}.properties.${key}`,
      })}`
    );
  });

  const currentPath = !parentPath
    ? "."
    : parentPath === "."
      ? node.name
      : `${parentPath}/${node.name}`;
  node.children.forEach((child, index) => {
    const childParent = currentPath;
    lines.push(
      "",
      ...renderNode({
        node: child,
        parentPath: childParent,
        nodePath: `${nodePath}.children[${index}]`,
        resourceIds,
        errors,
      })
    );
  });

  return lines;
};

const buildSceneText = ({ scene, assetPaths = [] }) => {
  const errors = [];
  const availableAssetPaths = new Set(assetPaths.map((assetPath) => `res://${toProjectPath(assetPath)}`));
  const resourceRefs = collectResourceRefs({ scene, availableAssetPaths, errors });
  const resourceIds = new Map(
    resourceRefs.map((resourcePath, index) => [
      resourcePath,
      resourceIdForPath(index + 1, resourcePath),
    ])
  );
  const lines = [`[gd_scene load_steps=${resourceRefs.length + 1} format=3]`, ""];

  resourceRefs.forEach((resourcePath) => {
    lines.push(
      `[ext_resource type="${inferResourceType(resourcePath)}" path="${quote(resourcePath)}" id="${resourceIds.get(resourcePath)}"]`
    );
  });

  if (resourceRefs.length) lines.push("");
  lines.push(
    ...renderNode({
      node: scene.root,
      parentPath: "",
      nodePath: "root",
      resourceIds,
      errors,
    })
  );

  return {
    path: toProjectPath(scene.path),
    content: `${lines.join("\n").trimEnd()}\n`,
    errors,
  };
};

const makeKeyEvent = (key) => {
  const keycode = KEYCODES[String(key || "").toUpperCase()];
  if (!keycode) return null;
  return `Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":${keycode},"physical_keycode":0,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)`;
};

const makeMouseEvent = (button) => {
  const buttonIndex = MOUSE_BUTTONS[String(button || "").toUpperCase()];
  if (!buttonIndex) return null;
  return `Object(InputEventMouseButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":0,"position":Vector2(0, 0),"global_position":Vector2(0, 0),"factor":1.0,"button_index":${buttonIndex},"canceled":false,"pressed":false,"double_click":false,"script":null)`;
};

const renderInputAction = (input, warnings) => {
  const events = (input.events || [])
    .map((event) => {
      if (event.type === "key") return makeKeyEvent(event.key);
      if (event.type === "mouse_button") return makeMouseEvent(event.button);
      warnings.push({
        code: "unsupported_input_event",
        message: `Unsupported input event type ${event.type} for ${input.name}`,
      });
      return null;
    })
    .filter(Boolean);

  if (!events.length) return null;
  return `${input.name}={\n"deadzone": 0.5,\n"events": [${events.join(", ")}]\n}`;
};

const buildProjectGodot = ({ manifest, projectName }) => {
  const warnings = [];
  const lines = [
    "; Engine configuration file.",
    "; Generated by Godot Assistant.",
    "config_version=5",
    "",
    "[application]",
    "",
    `config/name="${quote(projectName || manifest.game_type || "Generated Godot Project")}"`,
    `run/main_scene="${quote(manifest.main_scene)}"`,
    'config/features=PackedStringArray("4.6")',
    "",
  ];

  const inputLines = (manifest.inputs || [])
    .map((input) => renderInputAction(input, warnings))
    .filter(Boolean);
  if (inputLines.length) {
    lines.push("[input]", "", ...inputLines, "");
  }

  lines.push("[rendering]", "", 'renderer/rendering_method="gl_compatibility"', "");

  return {
    path: "project.godot",
    content: lines.join("\n"),
    warnings,
  };
};

const buildSceneFiles = ({ manifest, assetPaths = [] }) => {
  const errors = [];
  const files = manifest.scenes.map((scene) => {
    const result = buildSceneText({ scene, assetPaths });
    errors.push(...result.errors);
    return {
      path: result.path,
      content: result.content,
    };
  });

  return { files, errors };
};

module.exports = {
  buildProjectGodot,
  buildSceneFiles,
  buildSceneText,
};

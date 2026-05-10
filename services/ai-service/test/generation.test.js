const assert = require("assert");
const test = require("node:test");

const {
  normalizeManifest,
  validateProjectManifest,
} = require("../services/generation/manifest-schema");
const { buildProjectGodot, buildSceneFiles, buildSceneText } = require("../services/generation/scene-builder");
const {
  validateGeneratedProjectStatic,
  validateTscnExtResourceOrder,
} = require("../services/generation/static-validator");
const { validateFreeRoleConfig } = require("../services/generation/model-roles");
const {
  buildGeneratedProjectFiles,
  generateProjectManifest,
  makeModelClient,
  parseJsonObject,
} = require("../services/project-generator.service");
const { createOpenRouterError, getOpenRouterErrorMessage } = require("../services/openrouter.service");
const config = require("../config");

const makeBasicManifest = () =>
  normalizeManifest(
    {
      godot_version: "4.6",
      game_type: "arcade",
      main_scene: "res://scenes/Main.tscn",
      inputs: [{ name: "jump", events: [{ type: "key", key: "SPACE" }] }],
      autoloads: [],
      assets: [],
      scenes: [
        {
          path: "res://scenes/Main.tscn",
          root: {
            type: "Node2D",
            name: "Main",
            script: "res://scripts/main.gd",
          },
        },
      ],
      scripts: [{ path: "res://scripts/main.gd", extends: "Node2D" }],
      validation_expectations: [],
    },
    "4.6"
  );

test("manifest schema rejects wrong Godot version", () => {
  const result = validateProjectManifest({
    ...makeBasicManifest(),
    godot_version: "4.2",
  });

  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.code === "wrong_godot_version"));
});

test("scene builder defines ext_resources before usage", () => {
  const manifest = makeBasicManifest();
  const scene = buildSceneText({ scene: manifest.scenes[0] });

  const extIndex = scene.content.indexOf("[ext_resource");
  const usageIndex = scene.content.indexOf('script = ExtResource("');

  assert(extIndex > -1);
  assert(usageIndex > -1);
  assert(extIndex < usageIndex);
});

test("static validator catches ExtResource usage before definition", () => {
  const errors = validateTscnExtResourceOrder({
    file: {
      path: "scenes/Broken.tscn",
      content: `[gd_scene load_steps=2 format=3]

[node name="Main" type="Node2D"]
script = ExtResource("1_main")

[ext_resource type="Script" path="res://scripts/main.gd" id="1_main"]
`,
    },
  });

  assert(errors.some((error) => error.code === "ext_resource_used_before_definition"));
});

test("static validator catches missing script file paths", () => {
  const manifest = makeBasicManifest();
  const projectFile = buildProjectGodot({ manifest, projectName: "Missing Script" });
  const sceneFiles = buildSceneFiles({ manifest });
  const result = validateGeneratedProjectStatic({
    manifest,
    files: [projectFile, ...sceneFiles.files],
  });

  assert.equal(result.ok, false);
  assert(result.static_errors.some((error) => error.code === "missing_script_file"));
});

test("static validator ignores README directory references", () => {
  const manifest = makeBasicManifest();
  const projectFile = buildProjectGodot({ manifest, projectName: "Docs" });
  const sceneFiles = buildSceneFiles({ manifest });
  const result = validateGeneratedProjectStatic({
    manifest,
    files: [
      projectFile,
      ...sceneFiles.files,
      { path: "scripts/main.gd", content: "extends Node2D\n" },
      { path: "README.md", content: "Scripts live in res://scripts/.\n" },
    ],
  });

  assert.equal(result.ok, true, JSON.stringify(result.static_errors, null, 2));
});

test("project builder creates placeholder scenes for missing PackedScene references", () => {
  const manifest = makeBasicManifest();
  const generated = buildGeneratedProjectFiles({
    manifest,
    coderOutput: {
      files: [
        {
          path: "res://scripts/main.gd",
          content: `extends Node2D

const EnemyScene := preload("res://scenes/Enemy.tscn")
const BulletScene := preload("res://scenes/Bullet.tscn")
`,
        },
        {
          path: "res://scripts/enemy.gd",
          content: "extends Node2D\n",
        },
      ],
    },
    projectName: "Packed Scenes",
    prompt: "Build a shooter",
    assets: [],
    targetGodotVersion: "4.6",
  });
  const result = validateGeneratedProjectStatic({
    manifest: generated.manifest,
    files: generated.files,
  });

  assert(generated.files.some((file) => file.path === "scenes/Enemy.tscn"));
  assert(generated.files.some((file) => file.path === "scenes/Bullet.tscn"));
  assert.equal(result.ok, true, JSON.stringify(result.static_errors, null, 2));
});

test("OpenRouter role config loads free models only", () => {
  const result = validateFreeRoleConfig();

  assert.equal(result.ok, true, result.errors.join("; "));
  config.openRouter.modelCatalog.forEach((model) => {
    assert(model.endsWith(":free") || model === "openrouter/free", `${model} should be free`);
  });
  Object.values(result.roles).forEach((role) => {
    assert(role.modelId.endsWith(":free") || role.modelId === "openrouter/free");
    role.fallbackModels.forEach((model) => {
      assert(model.endsWith(":free") || model === "openrouter/free");
    });
  });
});

test("project generator parser quotes common Godot constructor values", () => {
  const parsed = parseJsonObject(`{
    "godot_version": "4.6",
    "scenes": [
      {
        "path": "res://scenes/Main.tscn",
        "root": {
          "type": "Node2D",
          "name": "Main",
          "properties": {
            "position": Vector2(0, 120),
            "modulate": Color(1, 0.5, 0.25, 1)
          }
        }
      }
    ]
  }`);

  assert.equal(parsed.scenes[0].root.properties.position, "Vector2(0, 120)");
  assert.equal(parsed.scenes[0].root.properties.modulate, "Color(1, 0.5, 0.25, 1)");
});

test("vision planner retries with attachment metadata when JSON is truncated", async () => {
  const calls = [];
  const streamer = async (call) => {
    calls.push(call);

    if (calls.length === 1) {
      assert(call.messages, "first planner request should use multimodal messages");
      call.onToken?.('{"godot_version":"4.6"');
      return { model: "vision-planner:free", finishReason: "stop" };
    }

    assert.equal(call.messages, undefined);
    assert.match(call.prompt, /Attached visual reference metadata/);
    call.onToken?.(JSON.stringify(makeBasicManifest()));
    return { model: "metadata-planner:free", finishReason: "stop" };
  };
  const client = makeModelClient({ streamer });

  const result = await client.generateJson({
    role: "planner",
    system: "Return strict JSON only.",
    prompt: "Plan a level from this layout reference.",
    attachments: [
      {
        name: "layout.png",
        mimeType: "image/png",
        size: 123,
        width: 64,
        height: 64,
        dataUrl: "data:image/png;base64,AAAA",
      },
    ],
  });

  assert.equal(calls.length, 2);
  assert.equal(result.model, "metadata-planner:free");
  assert.equal(result.json.main_scene, "res://scenes/Main.tscn");
});

test("OpenRouter spend-limit errors are user-actionable", () => {
  const detail = JSON.stringify({
    error:
      "API key USD spend limit exceeded. Your account may still have USD balance, but this API key has reached its configured USD spending limit.",
  });
  const error = createOpenRouterError({
    status: 402,
    detail,
    model: "qwen/qwen3-next-80b-a3b-instruct:free",
    attemptedModels: ["qwen/qwen3-next-80b-a3b-instruct:free"],
  });

  assert.equal(getOpenRouterErrorMessage(detail), "API key USD spend limit exceeded. Your account may still have USD balance, but this API key has reached its configured USD spending limit.");
  assert.equal(error.statusCode, 402);
  assert.equal(error.code, "OPENROUTER_SPEND_LIMIT_EXCEEDED");
  assert.match(error.message, /switch to another OPENROUTER_API_KEY|create a new key/);
});

test("repair loop stops after max iterations", async () => {
  let fixerCalls = 0;
  const aiClient = {
    async generateJson({ role }) {
      if (role === "planner") {
        return { model: "planner:free", json: makeBasicManifest() };
      }
      if (role === "coder") {
        return {
          model: "coder:free",
          json: {
            files: [
              {
                path: "res://scripts/main.gd",
                content: "extends KinematicBody2D\n",
              },
            ],
            notes: [],
          },
        };
      }
      if (role === "reviewer") {
        return { model: "reviewer:free", json: { approved: true, issues: [], suggested_fixes: [] } };
      }
      if (role === "fixer") {
        fixerCalls += 1;
        return {
          model: "fixer:free",
          json: {
            files: [
              {
                path: "res://scripts/main.gd",
                content: "extends KinematicBody2D\n",
              },
            ],
            notes: ["kept broken for test"],
          },
        };
      }
      throw new Error(`Unexpected role ${role}`);
    },
  };

  const result = await generateProjectManifest({
    prompt: "Build a small test project",
    options: { validationEnabled: true, repairIterations: 2 },
    aiClient,
  });

  assert.equal(result.success, false);
  assert.equal(result.repairIterationsUsed, 2);
  assert.equal(fixerCalls, 2);
});

test("mock Flappy Bird generation builds scenes and passes static validation", async () => {
  const flappyManifest = normalizeManifest(
    {
      godot_version: "4.6",
      game_type: "flappy bird clone",
      main_scene: "res://scenes/Main.tscn",
      inputs: [{ name: "flap", events: [{ type: "key", key: "SPACE" }] }],
      autoloads: [],
      assets: [],
      scenes: [
        {
          path: "res://scenes/Main.tscn",
          root: {
            type: "Node2D",
            name: "Main",
            script: "res://scripts/main.gd",
            children: [
              {
                type: "CharacterBody2D",
                name: "Bird",
                script: "res://scripts/bird.gd",
              },
              {
                type: "Timer",
                name: "PipeSpawnTimer",
                properties: {
                  wait_time: 1.4,
                  autostart: true,
                },
              },
            ],
          },
        },
      ],
      scripts: [
        { path: "res://scripts/main.gd", extends: "Node2D" },
        { path: "res://scripts/bird.gd", extends: "CharacterBody2D" },
      ],
      validation_expectations: ["Static validation passes."],
    },
    "4.6"
  );

  const aiClient = {
    async generateJson({ role }) {
      if (role === "planner") {
        return { model: "planner:free", json: flappyManifest };
      }
      if (role === "coder") {
        return {
          model: "coder:free",
          json: {
            files: [
              {
                path: "res://scripts/main.gd",
                content: `extends Node2D

func _ready() -> void:
\tprint("Flappy Bird clone ready")
`,
              },
              {
                path: "res://scripts/bird.gd",
                content: `extends CharacterBody2D

const GRAVITY := 1100.0
const FLAP_FORCE := -360.0

func _physics_process(delta: float) -> void:
\tvelocity.y += GRAVITY * delta
\tif Input.is_action_just_pressed("flap"):
\t\tvelocity.y = FLAP_FORCE
\tmove_and_slide()
`,
              },
            ],
            notes: ["Mock Flappy Bird prototype."],
          },
        };
      }
      if (role === "reviewer") {
        return { model: "reviewer:free", json: { approved: true, issues: [], suggested_fixes: [] } };
      }
      throw new Error(`Unexpected role ${role}`);
    },
  };

  const result = await generateProjectManifest({
    prompt: "Build a Flappy Bird clone",
    options: { validationEnabled: true, repairIterations: 2 },
    aiClient,
  });

  assert.equal(result.success, true, JSON.stringify(result.validation, null, 2));
  assert(result.files.some((file) => file.path === "scenes/Main.tscn"));
  assert(result.files.some((file) => file.path === "project.godot"));
  assert.equal(result.validation.ok, true);
});

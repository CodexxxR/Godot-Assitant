const fs = require("fs/promises");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/model-evaluations.json");

const BENCHMARK_TESTS = [
  {
    name: "characterbody2d_jump_controller",
    role: "coder",
    prompt: "Generate a Godot 4.6 CharacterBody2D jump controller.",
  },
  {
    name: "node2d_scene_manifest",
    role: "planner",
    prompt: "Generate a valid scene manifest for a simple Node2D scene.",
  },
  {
    name: "tscn_ext_resource_order_bug",
    role: "reviewer",
    prompt: "Identify a .tscn ext_resource ordering bug.",
  },
  {
    name: "godot_cli_error_fix",
    role: "fixer",
    prompt: "Fix a Godot CLI parse error in a generated project.",
  },
  {
    name: "flappy_bird_clone_plan",
    role: "planner",
    prompt: "Generate a Flappy Bird clone plan for Godot 4.6.",
  },
];

const readResults = async () => {
  try {
    const text = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const writeResults = async (results) => {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, `${JSON.stringify(results, null, 2)}\n`);
};

const recordEvaluationResult = async ({
  modelId,
  role,
  testName,
  passed,
  errors = [],
  latencyMs,
}) => {
  const results = await readResults();
  const entry = {
    modelId: String(modelId || ""),
    role: String(role || ""),
    testName: String(testName || ""),
    passed: Boolean(passed),
    errors: Array.isArray(errors) ? errors.map(String) : [String(errors)],
    latencyMs: Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : undefined,
    timestamp: new Date().toISOString(),
  };

  results.push(entry);
  await writeResults(results);
  return entry;
};

const listEvaluationResults = readResults;

module.exports = {
  BENCHMARK_TESTS,
  listEvaluationResults,
  recordEvaluationResult,
};

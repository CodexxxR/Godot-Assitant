const { execFile } = require("child_process");
const { promisify } = require("util");
const config = require("../../config");
const { toProjectPath } = require("./manifest-schema");

const execFileAsync = promisify(execFile);

const parseGodotErrors = (text = "") =>
  text
    .split(/\r?\n/)
    .filter((line) => /\b(error|failed|parse error|script error)\b/i.test(line))
    .map((line) => line.trim())
    .filter(Boolean);

const runGodotCommand = async (args) => {
  try {
    const { stdout, stderr } = await execFileAsync(config.godot.bin, args, {
      timeout: 45000,
      maxBuffer: 1024 * 1024,
    });

    return {
      ok: true,
      command: [config.godot.bin, ...args].join(" "),
      exitCode: 0,
      stdout,
      stderr,
      errors: parseGodotErrors(`${stdout}\n${stderr}`),
    };
  } catch (error) {
    const stdout = String(error.stdout || "");
    const stderr = String(error.stderr || "");

    return {
      ok: false,
      command: [config.godot.bin, ...args].join(" "),
      exitCode: Number(error.code || 1),
      stdout,
      stderr,
      errors: parseGodotErrors(`${stdout}\n${stderr}`),
    };
  }
};

const validateWithGodotCli = async ({ projectPath, mainScene, enabled }) => {
  const shouldRun = enabled ?? config.godot.enableCliValidation;
  const warnings = [];
  const cli_errors = [];
  const runs = [];

  if (!shouldRun) {
    return {
      ok: true,
      cli_errors,
      warnings: ["Godot CLI validation is disabled."],
      runs,
    };
  }

  if (!config.godot.bin) {
    return {
      ok: true,
      cli_errors,
      warnings: ["GODOT_BIN is not configured; skipped Godot CLI validation."],
      runs,
    };
  }

  if (!projectPath) {
    return {
      ok: true,
      cli_errors,
      warnings: ["No project path was provided; skipped Godot CLI validation."],
      runs,
    };
  }

  const importRun = await runGodotCommand(["--headless", "--path", projectPath, "--quit"]);
  runs.push(importRun);
  if (!importRun.ok || importRun.errors.length) {
    cli_errors.push(...(importRun.errors.length ? importRun.errors : [`Godot exited with ${importRun.exitCode}`]));
  }

  if (mainScene) {
    const sceneArg = `res://${toProjectPath(mainScene)}`;
    const sceneRun = await runGodotCommand([
      "--headless",
      "--path",
      projectPath,
      "-d",
      sceneArg,
      "--quit",
    ]);
    runs.push(sceneRun);
    if (!sceneRun.ok || sceneRun.errors.length) {
      cli_errors.push(...(sceneRun.errors.length ? sceneRun.errors : [`Godot scene check exited with ${sceneRun.exitCode}`]));
    }
  } else {
    warnings.push("No main scene configured; skipped scene debug check.");
  }

  return {
    ok: cli_errors.length === 0,
    cli_errors,
    warnings,
    runs,
  };
};

module.exports = {
  parseGodotErrors,
  validateWithGodotCli,
};

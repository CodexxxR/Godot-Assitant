const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const TEXT_EXTENSIONS = new Set([
  ".gd",
  ".gdshader",
  ".shader",
  ".tscn",
  ".tres",
  ".godot",
  ".cfg",
  ".ini",
  ".import",
  ".gdextension",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".html",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".cs",
]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".svg",
  ".ico",
  ".tga",
  ".exr",
  ".hdr",
  ".dds",
  ".ktx",
  ".ktx2",
]);
const PREVIEWABLE_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".svg",
  ".ico",
]);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS]);
const IMAGE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".tga": "image/x-tga",
  ".exr": "image/x-exr",
  ".hdr": "image/vnd.radiance",
  ".dds": "image/vnd-ms.dds",
  ".ktx": "image/ktx",
  ".ktx2": "image/ktx2",
};
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_ASSET_FILE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_TYPE_FILE_BYTES = 350 * 1024;
const MAX_TYPE_FILES = 420;
const MAX_TYPE_PACKAGE_FILES = 60;
const MAX_TYPE_TOTAL_BYTES = 8 * 1024 * 1024;
const CONFIG_FILE_NAMES = ["tsconfig.json", "jsconfig.json"];
const getLastProjectFile = () => path.join(app.getPath("userData"), "last-project.json");

function getRendererConsoleMessage(event) {
  return {
    level: event?.level,
    message: event?.message,
    lineNumber: event?.lineNumber,
    sourceId: event?.sourceId,
  };
}

function shouldLogRendererConsole(level, message) {
  if (typeof message !== "string" || !message.trim()) return false;
  if (typeof level === "number") return level >= 2;
  return ["error", "warning"].includes(String(level).toLowerCase());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "Godot Assistant",
    backgroundColor: "#11151c",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on("console-message", (event) => {
    const details = getRendererConsoleMessage(event);
    if (!shouldLogRendererConsole(details.level, details.message)) return;

    console.error(
      `[renderer] ${details.message} (${details.sourceId || "unknown"}:${details.lineNumber || "unknown"})`
    );
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(
      `[renderer] Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`
    );
  });

  win.loadURL("http://localhost:5173");
}

async function walkProject(rootPath, currentPath = rootPath, files = []) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".eslintrc") {
      continue;
    }

    const fullPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        await walkProject(rootPath, fullPath, files);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) continue;

    const stats = await fs.stat(fullPath);
    const kind = IMAGE_EXTENSIONS.has(extension) ? "image" : "text";
    const maxBytes = kind === "image" ? MAX_ASSET_FILE_BYTES : MAX_FILE_BYTES;
    if (stats.size > maxBytes) continue;

    files.push({
      name: entry.name,
      path: path.relative(rootPath, fullPath),
      size: stats.size,
      extension,
      kind,
      previewable:
        kind === "image" &&
        PREVIEWABLE_IMAGE_EXTENSIONS.has(extension) &&
        stats.size <= MAX_IMAGE_PREVIEW_BYTES,
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function resolveProjectFile(rootPath, filePath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, filePath);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("File is outside of selected project");
  }

  return target;
}

async function pathStat(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

const normalizeRelativePath = (rootPath, targetPath) =>
  path.relative(rootPath, targetPath).replace(/\\/g, "/");

const stripJsonComments = (text) =>
  text
    .replace(/^\uFEFF/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");

async function readJsonFile(filePath) {
  try {
    return JSON.parse(stripJsonComments(await fs.readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

function mergeCompilerOptions(baseConfig, overrideConfig) {
  return {
    ...(baseConfig || {}),
    ...(overrideConfig || {}),
    compilerOptions: {
      ...((baseConfig || {}).compilerOptions || {}),
      ...((overrideConfig || {}).compilerOptions || {}),
    },
  };
}

async function readProjectConfig(rootPath, configPath, seen = new Set()) {
  const fullPath = path.resolve(configPath);
  const root = path.resolve(rootPath);
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) return null;
  if (seen.has(fullPath)) return null;
  seen.add(fullPath);

  const config = await readJsonFile(fullPath);
  if (!config) return null;

  let merged = config;
  if (typeof config.extends === "string" && config.extends.startsWith(".")) {
    const extendedPath = path.resolve(path.dirname(fullPath), config.extends);
    const extendedConfigPath = path.extname(extendedPath)
      ? extendedPath
      : `${extendedPath}.json`;
    const baseConfig = await readProjectConfig(rootPath, extendedConfigPath, seen);
    merged = mergeCompilerOptions(baseConfig, config);
  }

  return {
    config: merged,
    configFile: normalizeRelativePath(rootPath, fullPath),
  };
}

async function findProjectConfig(rootPath) {
  for (const configFileName of CONFIG_FILE_NAMES) {
    const configPath = path.join(rootPath, configFileName);
    const stats = await pathStat(configPath);
    if (stats?.isFile()) {
      return readProjectConfig(rootPath, configPath);
    }
  }

  return {
    config: {},
    configFile: undefined,
  };
}

const isSafePackageName = (packageName) =>
  /^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(packageName);

const toTypesPackageName = (packageName) => {
  if (packageName.startsWith("@types/")) return packageName;
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.split("/");
    if (!scope || !name) return null;
    return `@types/${scope.slice(1)}__${name}`;
  }
  return `@types/${packageName}`;
};

function collectPackageNames(packageJson, compilerOptions) {
  const names = new Set();
  const dependencyGroups = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];

  dependencyGroups.forEach((groupName) => {
    Object.keys(packageJson?.[groupName] || {}).forEach((packageName) => {
      if (isSafePackageName(packageName)) names.add(packageName);
      const typesPackageName = toTypesPackageName(packageName);
      if (typesPackageName && isSafePackageName(typesPackageName)) {
        names.add(typesPackageName);
      }
    });
  });

  if (Array.isArray(compilerOptions?.types)) {
    compilerOptions.types.forEach((typeName) => {
      if (typeof typeName !== "string") return;
      const packageName = typeName.startsWith("@types/")
        ? typeName
        : toTypesPackageName(typeName);
      if (packageName && isSafePackageName(packageName)) names.add(packageName);
    });
  }

  return names;
}

async function listVisibleTypesPackages(rootPath) {
  const typesRoot = path.join(rootPath, "node_modules", "@types");
  const stats = await pathStat(typesRoot);
  if (!stats?.isDirectory()) return [];

  try {
    const entries = await fs.readdir(typesRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => `@types/${entry.name}`)
      .filter(isSafePackageName);
  } catch {
    return [];
  }
}

async function resolvePackageDirectory(rootPath, packageName) {
  if (!isSafePackageName(packageName)) return null;

  const packageDirectory = path.join(
    rootPath,
    "node_modules",
    ...packageName.split("/")
  );
  const stats = await pathStat(packageDirectory);

  return stats?.isDirectory() ? packageDirectory : null;
}

async function readPackageJson(packageDirectory) {
  const packageJsonPath = path.join(packageDirectory, "package.json");
  const stats = await pathStat(packageJsonPath);
  if (!stats?.isFile()) return null;
  return readJsonFile(packageJsonPath);
}

async function collectDeclarationFiles(packageDirectory, packageJson) {
  const files = [];
  const seen = new Set();
  const preferredFiles = [packageJson?.types, packageJson?.typings]
    .filter((item) => typeof item === "string")
    .map((item) => path.resolve(packageDirectory, item));

  for (const preferredFile of preferredFiles) {
    const stats = await pathStat(preferredFile);
    if (stats?.isFile() && preferredFile.endsWith(".d.ts")) {
      files.push(preferredFile);
      seen.add(preferredFile);
    }
  }

  const queue = [packageDirectory];
  while (queue.length > 0 && files.length < MAX_TYPE_PACKAGE_FILES) {
    const currentDirectory = queue.shift();
    let entries = [];

    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_TYPE_PACKAGE_FILES) break;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".d.ts") || seen.has(fullPath)) {
        continue;
      }

      files.push(fullPath);
      seen.add(fullPath);
    }
  }

  return files;
}

function collectPackageDependencies(packageJson) {
  const dependencies = new Set();
  ["dependencies", "peerDependencies", "optionalDependencies"].forEach((groupName) => {
    Object.keys(packageJson?.[groupName] || {}).forEach((packageName) => {
      if (isSafePackageName(packageName)) dependencies.add(packageName);
      const typesPackageName = toTypesPackageName(packageName);
      if (typesPackageName && isSafePackageName(typesPackageName)) {
        dependencies.add(typesPackageName);
      }
    });
  });
  return dependencies;
}

async function loadProjectTypeInfo(rootPath) {
  const packageJson = (await readJsonFile(path.join(rootPath, "package.json"))) || {};
  const { config, configFile } = await findProjectConfig(rootPath);
  const compilerOptions = config?.compilerOptions || {};
  const packageQueue = Array.from(collectPackageNames(packageJson, compilerOptions));

  if (!Array.isArray(compilerOptions.types)) {
    packageQueue.push(...(await listVisibleTypesPackages(rootPath)));
  }

  const queued = new Set(packageQueue);
  const processed = new Set();
  const filePaths = new Set();
  const typeLibs = [];
  let totalBytes = 0;

  while (
    packageQueue.length > 0 &&
    typeLibs.length < MAX_TYPE_FILES &&
    totalBytes < MAX_TYPE_TOTAL_BYTES
  ) {
    const packageName = packageQueue.shift();
    if (!packageName || processed.has(packageName)) continue;
    processed.add(packageName);

    const packageDirectory = await resolvePackageDirectory(rootPath, packageName);
    if (!packageDirectory) continue;

    const packageMetadata = await readPackageJson(packageDirectory);
    collectPackageDependencies(packageMetadata).forEach((dependencyName) => {
      if (!queued.has(dependencyName)) {
        queued.add(dependencyName);
        packageQueue.push(dependencyName);
      }
    });

    const declarationFiles = await collectDeclarationFiles(packageDirectory, packageMetadata);
    for (const declarationFile of declarationFiles) {
      if (typeLibs.length >= MAX_TYPE_FILES || filePaths.has(declarationFile)) continue;

      const stats = await pathStat(declarationFile);
      if (!stats?.isFile() || stats.size > MAX_TYPE_FILE_BYTES) continue;
      if (totalBytes + stats.size > MAX_TYPE_TOTAL_BYTES) break;

      filePaths.add(declarationFile);
      totalBytes += stats.size;
      typeLibs.push({
        filePath: normalizeRelativePath(rootPath, declarationFile),
        content: await fs.readFile(declarationFile, "utf8"),
        packageName,
      });
    }
  }

  return {
    compilerOptions,
    configFile,
    packageNames: Array.from(processed).sort(),
    typeLibs,
    totalBytes,
  };
}

const parseMemoryBytes = (value = "") => {
  const match = String(value).match(/([\d.]+)\s*(KB|MB|GB|TB)/i);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier = {
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  }[unit];

  return Number.isFinite(amount) && multiplier ? Math.round(amount * multiplier) : undefined;
};

async function readMacHardwareInfo() {
  if (process.platform !== "darwin") return {};

  try {
    const { stdout } = await execFileAsync(
      "system_profiler",
      ["SPHardwareDataType", "SPDisplaysDataType", "-json"],
      { maxBuffer: 5 * 1024 * 1024, timeout: 8000 }
    );
    const parsed = JSON.parse(stdout);
    const hardware = parsed.SPHardwareDataType?.[0] || {};
    const displays = parsed.SPDisplaysDataType || [];

    return {
      chip: hardware.chip_type || hardware.machine_model,
      modelName: hardware.machine_name || hardware.model_name,
      serialNumber: hardware.serial_number,
      gpus: displays
        .map((display) => ({
          model: display.sppci_model || display._name || display.spdisplays_vendor || "GPU",
          vendor: display.spdisplays_vendor,
          vramBytes: parseMemoryBytes(display.spdisplays_vram || display.spdisplays_vram_shared),
          metal: display.spdisplays_metal,
        }))
        .filter((gpu) => gpu.model),
    };
  } catch {
    return {};
  }
}

async function getSystemInfo() {
  const cpus = os.cpus();
  const hardware = await readMacHardwareInfo();

  return {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    osRelease: os.release(),
    modelName: hardware.modelName,
    cpu: {
      model: hardware.chip || cpus[0]?.model || "Unknown CPU",
      cores: cpus.length,
      speedMhz: cpus[0]?.speed || 0,
    },
    memory: {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem(),
    },
    gpu: {
      models: hardware.gpus?.map((gpu) => gpu.model) || [],
      devices: hardware.gpus || [],
    },
  };
}

ipcMain.handle("project:select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select Project Folder",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const rootPath = result.filePaths[0];
  const files = await walkProject(rootPath);

  return {
    rootPath,
    name: path.basename(rootPath),
    files,
  };
});

ipcMain.handle("project:remember", async (_event, payload) => {
  const rootPath = String(payload?.rootPath || "");
  if (!rootPath) return false;

  await fs.writeFile(
    getLastProjectFile(),
    JSON.stringify(
      {
        rootPath,
        name: String(payload?.name || path.basename(rootPath)),
        rememberedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return true;
});

ipcMain.handle("project:load-last", async () => {
  try {
    const raw = await fs.readFile(getLastProjectFile(), "utf8");
    const savedProject = JSON.parse(raw);
    const rootPath = String(savedProject?.rootPath || "");

    if (!rootPath) return null;

    const stats = await fs.stat(rootPath);
    if (!stats.isDirectory()) return null;

    return {
      rootPath,
      name: String(savedProject?.name || path.basename(rootPath)),
      files: await walkProject(rootPath),
    };
  } catch {
    return null;
  }
});

ipcMain.handle("project:read-file", async (_event, payload) => {
  const rootPath = String(payload?.rootPath || "");
  const filePath = String(payload?.filePath || "");
  const extension = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) {
    throw new Error(`Cannot read binary asset as text: ${extension || "none"}`);
  }

  const fullPath = resolveProjectFile(rootPath, filePath);
  return fs.readFile(fullPath, "utf8");
});

ipcMain.handle("project:read-asset", async (_event, payload) => {
  const rootPath = String(payload?.rootPath || "");
  const filePath = String(payload?.filePath || "");
  const extension = path.extname(filePath).toLowerCase();

  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported Godot asset type: ${extension || "none"}`);
  }

  const fullPath = resolveProjectFile(rootPath, filePath);
  const stats = await fs.stat(fullPath);
  const mimeType = IMAGE_MIME_TYPES[extension] || "application/octet-stream";
  const previewable =
    PREVIEWABLE_IMAGE_EXTENSIONS.has(extension) && stats.size <= MAX_IMAGE_PREVIEW_BYTES;
  let dataUrl = "";
  let width = 0;
  let height = 0;

  if (previewable) {
    const buffer = await fs.readFile(fullPath);
    dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

    const image = nativeImage.createFromBuffer(buffer);
    if (!image.isEmpty()) {
      const size = image.getSize();
      width = size.width;
      height = size.height;
    }
  }

  return {
    dataUrl,
    fileName: filePath,
    mimeType,
    previewable,
    size: stats.size,
    width,
    height,
  };
});

ipcMain.handle("project:list-files", async (_event, payload) => {
  const rootPath = String(payload?.rootPath || "");
  const rootStats = await pathStat(rootPath);

  if (!rootStats?.isDirectory()) {
    throw new Error("Project folder does not exist");
  }

  return walkProject(path.resolve(rootPath));
});

ipcMain.handle("project:load-type-info", async (_event, payload) => {
  const rootPath = String(payload?.rootPath || "");
  const rootStats = await pathStat(rootPath);

  if (!rootStats?.isDirectory()) {
    throw new Error("Project folder does not exist");
  }

  return loadProjectTypeInfo(path.resolve(rootPath));
});

ipcMain.handle("system:get-info", async () => getSystemInfo());

ipcMain.handle("project:write-file", async (_event, payload) => {
  const rootPath = String(payload?.rootPath || "");
  const filePath = String(payload?.filePath || "");
  const text = String(payload?.text ?? "");
  const extension = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) {
    throw new Error(`Cannot overwrite binary asset as text: ${extension || "none"}`);
  }

  const fullPath = resolveProjectFile(rootPath, filePath);
  await fs.writeFile(fullPath, text, "utf8");
  return true;
});

ipcMain.handle("project:create-file", async (_event, payload) => {
  const rootPath = String(payload?.rootPath || "");
  const filePath = String(payload?.filePath || "");
  const text = String(payload?.text ?? "");
  const extension = path.extname(filePath).toLowerCase();

  if (!TEXT_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported Godot file type: ${extension || "none"}`);
  }

  const fullPath = resolveProjectFile(rootPath, filePath);
  const existingStats = await pathStat(fullPath);
  if (existingStats) {
    throw new Error("A file already exists at that path");
  }

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, text, "utf8");

  const stats = await fs.stat(fullPath);
  return {
    name: path.basename(fullPath),
    path: normalizeRelativePath(path.resolve(rootPath), fullPath),
    size: stats.size,
    extension,
    kind: "text",
    previewable: false,
  };
});

ipcMain.handle("project:delete-file", async (_event, payload) => {
  const rootPath = String(payload?.rootPath || "");
  const filePath = String(payload?.filePath || "");
  const extension = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported Godot file type: ${extension || "none"}`);
  }

  const fullPath = resolveProjectFile(rootPath, filePath);
  const stats = await pathStat(fullPath);
  if (!stats?.isFile()) {
    throw new Error("File does not exist");
  }

  await fs.rm(fullPath);

  return {
    filePath: normalizeRelativePath(path.resolve(rootPath), fullPath),
  };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

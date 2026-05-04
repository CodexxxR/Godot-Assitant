const path = require("path");
const parser = require("@babel/parser");
const { sha1 } = require("./hash");

const PARSER_PLUGINS = [
  "jsx",
  "typescript",
  "decorators-legacy",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "dynamicImport",
  "importMeta",
  "topLevelAwait",
];

const RESOLUTION_EXTENSIONS = [
  "",
  ".gd",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  "/index.json",
];

const normalizePath = (filePath = "") => filePath.replace(/\\/g, "/");

const getExtension = (fileName = "") => path.extname(fileName).toLowerCase();

const resolveImport = ({ fromFile, specifier, knownFiles }) => {
  if (!specifier || !specifier.startsWith(".")) return null;

  const fromDirectory = path.posix.dirname(normalizePath(fromFile));
  const basePath = path.posix.normalize(path.posix.join(fromDirectory, specifier));

  for (const extension of RESOLUTION_EXTENSIONS) {
    const candidate = normalizePath(`${basePath}${extension}`);
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
};

const resolveGodotResource = ({ specifier, knownFiles }) => {
  if (!specifier || !specifier.startsWith("res://")) return null;

  const candidate = normalizePath(specifier.replace(/^res:\/\//, ""));
  return knownFiles.has(candidate) ? candidate : null;
};

const getDeclarationName = (declaration) => {
  if (!declaration) return null;
  if (declaration.id?.name) return declaration.id.name;
  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations
      .map((item) => item.id?.name)
      .filter(Boolean)
      .join(", ");
  }
  return null;
};

const analyzeJavaScriptLikeFile = ({ text, fileName, knownFiles }) => {
  const ast = parser.parse(text, {
    sourceType: "unambiguous",
    plugins: PARSER_PLUGINS,
    errorRecovery: true,
  });

  const imports = [];
  const exports = [];

  ast.program.body.forEach((node) => {
    if (node.type === "ImportDeclaration" && node.source?.value) {
      imports.push(String(node.source.value));
      return;
    }

    if (
      (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
      node.source?.value
    ) {
      imports.push(String(node.source.value));
    }

    if (node.type === "ExportDefaultDeclaration") {
      exports.push("default");
      return;
    }

    if (node.type === "ExportNamedDeclaration") {
      const declarationName = getDeclarationName(node.declaration);
      if (declarationName) {
        exports.push(...declarationName.split(", ").filter(Boolean));
      }

      node.specifiers?.forEach((specifier) => {
        const exported = specifier.exported?.name || specifier.exported?.value;
        if (exported) exports.push(String(exported));
      });
    }
  });

  const normalizedImports = Array.from(new Set(imports));

  return {
    imports: normalizedImports,
    resolvedImports: normalizedImports
      .map((specifier) => resolveImport({ fromFile: fileName, specifier, knownFiles }))
      .filter(Boolean),
    exports: Array.from(new Set(exports)).slice(0, 80),
  };
};

const analyzeGdscriptFile = ({ text, knownFiles }) => {
  const imports = [];
  const exports = [];

  const className = text.match(/^\s*class_name\s+([A-Za-z_][A-Za-z0-9_]*)/m)?.[1];
  if (className) exports.push(className);

  for (const match of text.matchAll(/\b(?:preload|load)\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    imports.push(match[1]);
  }

  for (const match of text.matchAll(/^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) {
    exports.push(`func ${match[1]}`);
  }

  for (const match of text.matchAll(/^\s*signal\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    exports.push(`signal ${match[1]}`);
  }

  const normalizedImports = Array.from(new Set(imports));

  return {
    imports: normalizedImports,
    resolvedImports: normalizedImports
      .map((specifier) => resolveGodotResource({ specifier, knownFiles }))
      .filter(Boolean),
    exports: Array.from(new Set(exports)).slice(0, 80),
  };
};

const analyzeFile = ({ text, fileName, knownFileNames = [] }) => {
  const normalizedFileName = normalizePath(fileName);
  const knownFiles = new Set(knownFileNames.map(normalizePath));
  const extension = getExtension(normalizedFileName);
  const base = {
    fileName: normalizedFileName,
    extension,
    contentHash: sha1(text),
    size: text.length,
    imports: [],
    resolvedImports: [],
    exports: [],
  };

  if (extension === ".gd") {
    return {
      ...base,
      ...analyzeGdscriptFile({
        text,
        fileName: normalizedFileName,
        knownFiles,
      }),
    };
  }

  if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    return base;
  }

  try {
    return {
      ...base,
      ...analyzeJavaScriptLikeFile({
        text,
        fileName: normalizedFileName,
        knownFiles,
      }),
    };
  } catch {
    return base;
  }
};

module.exports = {
  analyzeFile,
  normalizePath,
  resolveImport,
};

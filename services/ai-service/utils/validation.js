const SUPPORTED_EXTENSIONS = new Set([
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
  ".yml",
  ".yaml",
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
  ".txt",
  ".cs",
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

const isSupportedFileName = (fileName = "") => {
  const lower = fileName.toLowerCase();
  return Array.from(SUPPORTED_EXTENSIONS).some((extension) =>
    lower.endsWith(extension)
  );
};

const requireString = (value, fieldName) => {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`${fieldName} is required`);
    error.statusCode = 400;
    throw error;
  }

  return value.trim();
};

module.exports = { isSupportedFileName, requireString, SUPPORTED_EXTENSIONS };

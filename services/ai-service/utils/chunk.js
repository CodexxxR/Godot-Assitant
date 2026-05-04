const parser = require("@babel/parser");
const config = require("../config");

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

const getLineNumber = (text, index) => {
  if (typeof index !== "number") return 1;
  return text.slice(0, index).split("\n").length;
};

const createChunk = ({ content, fileName, type, index, startLine, endLine }) => ({
  content: content.trim(),
  fileName,
  type,
  index,
  startLine,
  endLine,
});

const isImportLikeNode = (node) =>
  node.type === "ImportDeclaration" ||
  (node.type === "ExportNamedDeclaration" && node.source && !node.declaration) ||
  (node.type === "ExportAllDeclaration" && node.source);

const splitLargeContent = ({ content, fileName, type, startLine, maxChunkChars }) => {
  if (content.length <= maxChunkChars) {
    return [
      createChunk({
        content,
        fileName,
        type,
        index: 0,
        startLine,
        endLine: startLine + content.split("\n").length - 1,
      }),
    ];
  }

  const chunks = [];
  const lines = content.split("\n");
  let buffer = [];
  let bufferStartLine = startLine;
  let size = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) return;

    chunks.push(
      createChunk({
        content: buffer.join("\n"),
        fileName,
        type,
        index: chunks.length,
        startLine: bufferStartLine,
        endLine: bufferStartLine + buffer.length - 1,
      })
    );
    buffer = [];
    size = 0;
  };

  lines.forEach((line, lineIndex) => {
    const lineSize = line.length + 1;
    const currentLineNumber = startLine + lineIndex;

    if (lineSize > maxChunkChars) {
      flushBuffer();

      for (let offset = 0; offset < line.length; offset += maxChunkChars) {
        chunks.push(
          createChunk({
            content: line.slice(offset, offset + maxChunkChars),
            fileName,
            type,
            index: chunks.length,
            startLine: currentLineNumber,
            endLine: currentLineNumber,
          })
        );
      }

      bufferStartLine = currentLineNumber + 1;
      return;
    }

    const shouldFlush = size + lineSize > maxChunkChars && buffer.length > 0;

    if (shouldFlush) {
      flushBuffer();
      bufferStartLine = currentLineNumber;
    }

    buffer.push(line);
    size += lineSize;
  });

  if (buffer.length > 0) {
    flushBuffer();
  }

  return chunks.filter((chunk) => chunk.content.length > 0);
};

const chunkJson = (text, fileName, maxChunkChars) => {
  let content = text;

  try {
    content = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    content = text;
  }

  return splitLargeContent({
    content,
    fileName,
    type: "code",
    startLine: 1,
    maxChunkChars,
  }).map((chunk, index) => ({ ...chunk, index }));
};

const chunkWithAst = (text, fileName, maxChunkChars) => {
  const ast = parser.parse(text, {
    sourceType: "unambiguous",
    plugins: PARSER_PLUGINS,
    errorRecovery: true,
    ranges: false,
  });

  const chunks = [];
  const importNodes = ast.program.body.filter(isImportLikeNode);
  const codeNodes = ast.program.body.filter((node) => !isImportLikeNode(node));

  if (importNodes.length > 0) {
    const start = importNodes[0].start || 0;
    const end = importNodes[importNodes.length - 1].end || start;
    const importPieces = splitLargeContent({
      content: text.slice(start, end),
      fileName,
      type: "import",
      startLine: getLineNumber(text, start),
      maxChunkChars,
    });

    importPieces.forEach((piece) => {
      chunks.push({
        ...piece,
        index: chunks.length,
      });
    });
  }

  codeNodes.forEach((node) => {
    if (typeof node.start !== "number" || typeof node.end !== "number") return;

    const content = text.slice(node.start, node.end).trim();
    if (!content) return;

    const startLine = getLineNumber(text, node.start);
    const pieces = splitLargeContent({
      content,
      fileName,
      type: "code",
      startLine,
      maxChunkChars,
    });

    pieces.forEach((piece) => {
      chunks.push({
        ...piece,
        index: chunks.length,
      });
    });
  });

  return chunks.filter((chunk) => chunk.content.length > 0);
};

const fallbackChunk = (text, fileName, maxChunkChars) => {
  const importMatch = text.match(/^(\s*(import|export|extends|class_name)\s+[^;\n]+;?\s*)+/m);
  const chunks = [];

  if (importMatch) {
    const importChunks = splitLargeContent({
      content: importMatch[0],
      fileName,
      type: "import",
      startLine: getLineNumber(text, importMatch.index || 0),
      maxChunkChars,
    });

    importChunks.forEach((chunk) => {
      chunks.push({
        ...chunk,
        index: chunks.length,
      });
    });
  }

  const code = importMatch ? text.replace(importMatch[0], "") : text;
  const codeChunks = splitLargeContent({
    content: code,
    fileName,
    type: "code",
    startLine: importMatch ? chunks[0].endLine + 1 : 1,
    maxChunkChars,
  });

  codeChunks.forEach((chunk) => {
    chunks.push({
      ...chunk,
      index: chunks.length,
    });
  });

  return chunks.filter((chunk) => chunk.content.length > 0);
};

const chunkGdscript = (text, fileName, maxChunkChars) => {
  const lines = text.split("\n");
  const chunks = [];
  const headerLines = [];
  const blockStarts = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (
      /^(extends|class_name|signal|@export|@onready|const|enum)\b/.test(trimmed) ||
      /\b(preload|load)\s*\(\s*["']res:\/\//.test(trimmed)
    ) {
      headerLines.push({ line, lineNumber: index + 1 });
    }

    if (/^(func|static func|class|var|const|signal|enum)\b/.test(trimmed)) {
      blockStarts.push(index);
    }
  });

  if (headerLines.length > 0) {
    const content = headerLines.map((item) => item.line).join("\n");
    splitLargeContent({
      content,
      fileName,
      type: "import",
      startLine: headerLines[0].lineNumber,
      maxChunkChars,
    }).forEach((piece) => {
      chunks.push({ ...piece, index: chunks.length });
    });
  }

  if (blockStarts.length === 0) {
    return splitLargeContent({
      content: text,
      fileName,
      type: "code",
      startLine: 1,
      maxChunkChars,
    }).map((chunk, index) => ({ ...chunk, index }));
  }

  blockStarts.forEach((start, index) => {
    const end = blockStarts[index + 1] ?? lines.length;
    const content = lines.slice(start, end).join("\n").trim();
    if (!content) return;

    splitLargeContent({
      content,
      fileName,
      type: "code",
      startLine: start + 1,
      maxChunkChars,
    }).forEach((piece) => {
      chunks.push({ ...piece, index: chunks.length });
    });
  });

  return chunks.filter((chunk) => chunk.content.length > 0);
};

const chunkCode = (text, fileName = "unknown", options = {}) => {
  const maxChunkChars = options.maxChunkChars || config.ingestion.maxChunkChars;
  const lowerFileName = fileName.toLowerCase();

  if (lowerFileName.endsWith(".json")) {
    return chunkJson(text, fileName, maxChunkChars);
  }

  if (lowerFileName.endsWith(".gd")) {
    return chunkGdscript(text, fileName, maxChunkChars);
  }

  try {
    return chunkWithAst(text, fileName, maxChunkChars);
  } catch {
    return fallbackChunk(text, fileName, maxChunkChars);
  }
};

module.exports = { chunkCode };

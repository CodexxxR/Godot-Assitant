const config = require("../config");
const { embedText } = require("./embedding.service");
const { getProjectGraph } = require("./project.service");
const { getDocumentsForFiles, queryDocuments } = require("./vector.service");
const { requireString } = require("../utils/validation");
const { logger } = require("../utils/logger");

const tokenize = (text = "") =>
  Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_.$/-]+/)
        .filter((token) => token.length > 2)
    )
  );

const calculateTokenOverlap = (leftText, rightText) => {
  const left = tokenize(leftText);
  if (left.length === 0) return 0;

  const right = new Set(tokenize(rightText));
  const overlap = left.filter((token) => right.has(token)).length;
  return overlap / left.length;
};

const dedupeChunks = (chunks) => {
  const seen = new Set();
  const deduped = [];

  chunks.forEach((chunk) => {
    const key =
      chunk.id ||
      [
        chunk.metadata.projectId,
        chunk.metadata.fileName,
        chunk.metadata.type,
        chunk.metadata.chunkIndex,
      ].join(":");

    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(chunk);
  });

  return deduped;
};

const sortByFileAndLine = (chunks) =>
  [...chunks].sort((a, b) => {
    const fileCompare = String(a.metadata.fileName || "").localeCompare(
      String(b.metadata.fileName || "")
    );

    if (fileCompare !== 0) return fileCompare;

    return Number(a.metadata.startLine || 0) - Number(b.metadata.startLine || 0);
  });

const getMentionedFiles = ({ message, files }) => {
  const lowerMessage = message.toLowerCase();
  return new Set(
    Object.keys(files).filter((fileName) => {
      const lowerFileName = fileName.toLowerCase();
      const baseName = lowerFileName.split("/").pop();
      return lowerMessage.includes(lowerFileName) || lowerMessage.includes(baseName);
    })
  );
};

const scoreChunk = ({
  chunk,
  message,
  selectedCode,
  selectedFile,
  relatedFiles,
  mentionedFiles,
}) => {
  const fileName = String(chunk.metadata.fileName || "");
  let score =
    typeof chunk.distance === "number" ? 1 / (1 + Math.max(chunk.distance, 0)) : 0.38;

  if (fileName === selectedFile) score += 0.45;
  if (relatedFiles.has(fileName)) score += 0.28;
  if (mentionedFiles.has(fileName)) score += 0.35;
  if (chunk.metadata.type === "import") score += 0.08;

  score += Math.min(calculateTokenOverlap(message, chunk.text) * 0.25, 0.25);
  if (selectedCode) {
    score += Math.min(calculateTokenOverlap(selectedCode, chunk.text) * 0.18, 0.18);
  }

  return score;
};

const rankChunks = ({ chunks, message, selectedCode, selectedFile, graph }) => {
  const relatedFiles = new Set(graph.relatedFiles || []);
  const mentionedFiles = getMentionedFiles({ message, files: graph.files || {} });

  return dedupeChunks(chunks)
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk({
        chunk,
        message,
        selectedCode,
        selectedFile,
        relatedFiles,
        mentionedFiles,
      }),
    }))
    .sort((a, b) => b.score - a.score);
};

const buildContext = (chunks, maxChars = config.retrieval.maxContextChars) => {
  const selectedChunks = [];
  let charCount = 0;

  for (const chunk of chunks) {
    const nextSize = chunk.text.length + 220;
    if (selectedChunks.length > 0 && charCount + nextSize > maxChars) continue;

    selectedChunks.push(chunk);
    charCount += nextSize;
  }

  const grouped = new Map();

  selectedChunks.forEach((chunk) => {
    const fileName = chunk.metadata.fileName || "unknown";
    if (!grouped.has(fileName)) {
      grouped.set(fileName, { bestScore: chunk.score || 0, chunks: [] });
    }

    const group = grouped.get(fileName);
    group.bestScore = Math.max(group.bestScore, chunk.score || 0);
    group.chunks.push(chunk);
  });

  return Array.from(grouped.entries())
    .sort(([, a], [, b]) => b.bestScore - a.bestScore)
    .map(([fileName, group]) => {
      const body = sortByFileAndLine(group.chunks)
        .map((chunk) => {
          const lineRange = chunk.metadata.startLine
            ? `lines ${chunk.metadata.startLine}-${chunk.metadata.endLine}`
            : "lines unknown";
          const relevance =
            typeof chunk.score === "number" ? `, relevance ${chunk.score.toFixed(2)}` : "";

          return [
            `// ${chunk.metadata.type} context, ${lineRange}${relevance}`,
            chunk.text,
          ].join("\n");
        })
        .join("\n\n");

      return [`### File: ${fileName}`, body].join("\n");
    })
    .join("\n\n");
};

const getRelatedContextChunks = async ({ projectId, selectedFile, message, graph }) => {
  const mentionedFiles = getMentionedFiles({ message, files: graph.files || {} });
  const fileNames = Array.from(
    new Set([selectedFile, ...(graph.relatedFiles || []), ...mentionedFiles].filter(Boolean))
  );

  if (fileNames.length === 0) return [];

  return getDocumentsForFiles({
    projectId,
    fileNames,
    limitPerFile: config.retrieval.relatedFileChunks,
  });
};

const retrieveProjectContext = async ({ projectId, message, selectedCode, selectedFile }) => {
  const validProjectId = requireString(projectId, "projectId");
  const validMessage = requireString(message, "message");
  const queryEmbedding = await embedText(validMessage);

  if (!queryEmbedding) {
    const error = new Error("Could not generate query embedding");
    error.statusCode = 502;
    throw error;
  }

  const graph = getProjectGraph(validProjectId, selectedFile);
  const [vectorChunks, relatedChunks] = await Promise.all([
    queryDocuments(queryEmbedding, validProjectId, {
      codeLimit: config.retrieval.candidateCodeChunks,
      importLimit: config.retrieval.candidateImportChunks,
    }),
    getRelatedContextChunks({
      projectId: validProjectId,
      selectedFile,
      message: validMessage,
      graph,
    }),
  ]);

  const chunks = rankChunks({
    chunks: [...relatedChunks, ...vectorChunks],
    message: validMessage,
    selectedCode,
    selectedFile,
    graph,
  });

  logger.info("Retrieved context", {
    projectId: validProjectId,
    chunks: chunks.length,
    selectedFile,
    relatedFiles: graph.relatedFiles.length,
  });

  return {
    chunks,
    context: buildContext(chunks),
    graph,
  };
};

module.exports = { retrieveProjectContext, buildContext, rankChunks };

const config = require("../config");
const { embedTexts } = require("./embedding.service");
const { addDocuments, deleteFileChunks } = require("./vector.service");
const { forgetIndexedFile, recordIndexedFile } = require("./project.service");
const { chunkCode } = require("../utils/chunk");
const { sha1 } = require("../utils/hash");
const { isSupportedFileName, requireString } = require("../utils/validation");
const { logger } = require("../utils/logger");

const createChunkId = ({ projectId, fileName, chunk }) =>
  sha1(
    [
      projectId,
      fileName,
      chunk.type,
      chunk.index,
      chunk.startLine,
      chunk.endLine,
      sha1(chunk.content),
    ].join(":")
  );

const validateFileForIndexing = ({ projectId, fileName, text }) => {
  const validProjectId = requireString(projectId, "projectId");
  const validFileName = requireString(fileName, "fileName");

  if (!isSupportedFileName(validFileName)) {
    const error = new Error("Unsupported file type");
    error.statusCode = 400;
    throw error;
  }

  if (typeof text !== "string" || text.trim().length < 2) {
    logger.info("Skipping empty file", {
      projectId: validProjectId,
      fileName: validFileName,
    });

    return {
      projectId: validProjectId,
      fileName: validFileName,
      indexedChunks: 0,
      skippedChunks: 0,
      skipped: true,
      reason: "File is empty or too small to index",
    };
  }

  if (text.length > config.ingestion.maxFileChars) {
    logger.warn("Skipping oversized file", {
      projectId: validProjectId,
      fileName: validFileName,
      chars: text.length,
    });

    return {
      projectId: validProjectId,
      fileName: validFileName,
      indexedChunks: 0,
      skippedChunks: 0,
      skipped: true,
      reason: "File exceeds MAX_FILE_CHARS",
    };
  }

  return {
    projectId: validProjectId,
    fileName: validFileName,
    text,
  };
};

const indexPreparedFiles = async ({ projectId, files, knownFileNames }) => {
  const chunkRecords = [];
  const results = files.map((file) => ({
    projectId,
    fileName: file.fileName,
    indexedChunks: 0,
    skippedChunks: 0,
    skipped: false,
  }));

  files.forEach((file, fileIndex) => {
    const chunks = chunkCode(file.text, file.fileName);

    if (chunks.length === 0) {
      results[fileIndex] = {
        ...results[fileIndex],
        skipped: true,
        reason: "No chunks generated",
      };
      return;
    }

    chunks.forEach((chunk) => {
      chunkRecords.push({
        fileIndex,
        file,
        chunk,
      });
    });
  });

  if (chunkRecords.length === 0) {
    return results;
  }

  logger.info("Embedding project chunks", {
    projectId,
    files: files.length,
    chunks: chunkRecords.length,
  });

  const embeddings = await embedTexts(chunkRecords.map((record) => record.chunk.content));
  const docs = [];

  chunkRecords.forEach((record, index) => {
    const embedding = embeddings[index];
    const result = results[record.fileIndex];

    if (!embedding) {
      result.skippedChunks += 1;
      logger.warn("Skipping chunk with invalid embedding", {
        projectId,
        fileName: record.file.fileName,
        chunkIndex: record.chunk.index,
      });
      return;
    }

    docs.push({
      id: createChunkId({
        projectId,
        fileName: record.file.fileName,
        chunk: record.chunk,
      }),
      text: record.chunk.content,
      embedding,
      metadata: {
        projectId,
        fileName: record.file.fileName,
        type: record.chunk.type,
        chunkIndex: record.chunk.index,
        startLine: record.chunk.startLine,
        endLine: record.chunk.endLine,
      },
    });

    result.indexedChunks += 1;
  });

  if (docs.length === 0) {
    logger.warn("No chunks indexed for project batch", {
      projectId,
      files: files.length,
    });

    return results.map((result) => ({
      ...result,
      skipped: true,
      reason: result.reason || "No valid embeddings generated",
    }));
  }

  await Promise.all(
    files.map((file) => deleteFileChunks({ projectId, fileName: file.fileName }))
  );

  await addDocuments(docs);

  files.forEach((file, fileIndex) => {
    const fileChunks = chunkRecords
      .filter((record) => record.fileIndex === fileIndex)
      .map((record) => record.chunk);

    if (results[fileIndex].indexedChunks === 0) {
      results[fileIndex].skipped = true;
      results[fileIndex].reason = results[fileIndex].reason || "No valid embeddings generated";
      return;
    }

    recordIndexedFile({
      projectId,
      fileName: file.fileName,
      text: file.text,
      chunks: fileChunks,
      knownFileNames,
    });
  });

  logger.info("Indexed project batch", {
    projectId,
    files: files.length,
    indexedChunks: docs.length,
    skippedChunks: results.reduce((sum, result) => sum + result.skippedChunks, 0),
  });

  return results;
};

const indexFile = async ({ projectId, fileName, text }) => {
  const validation = validateFileForIndexing({ projectId, fileName, text });

  if (validation.skipped) return validation;

  const [result] = await indexPreparedFiles({
    projectId: validation.projectId,
    files: [validation],
    knownFileNames: [validation.fileName],
  });

  return result;
};

const indexFiles = async ({ projectId, files }) => {
  const validProjectId = requireString(projectId, "projectId");
  const knownFileNames = Array.isArray(files)
    ? files.map((file) => String(file?.fileName || "")).filter(Boolean)
    : [];

  if (!Array.isArray(files) || files.length === 0) {
    const error = new Error("files must be a non-empty array");
    error.statusCode = 400;
    throw error;
  }

  const preparedFiles = [];
  const skippedResults = [];

  files.forEach((file) => {
    const validation = validateFileForIndexing({
      projectId: validProjectId,
      fileName: file?.fileName,
      text: file?.text,
    });

    if (validation.skipped) {
      skippedResults.push(validation);
    } else {
      preparedFiles.push(validation);
    }
  });

  const indexedResults =
    preparedFiles.length > 0
      ? await indexPreparedFiles({
          projectId: validProjectId,
          files: preparedFiles,
          knownFileNames,
        })
      : [];

  return {
    projectId: validProjectId,
    files: [...skippedResults, ...indexedResults],
    indexedFiles: indexedResults.filter((result) => !result.skipped).length,
    indexedChunks: indexedResults.reduce((sum, result) => sum + result.indexedChunks, 0),
    skippedFiles:
      skippedResults.length + indexedResults.filter((result) => result.skipped).length,
  };
};

const deleteIndexedFile = async ({ projectId, fileName }) => {
  const validProjectId = requireString(projectId, "projectId");
  const validFileName = requireString(fileName, "fileName");
  const deletedChunks = await deleteFileChunks({
    projectId: validProjectId,
    fileName: validFileName,
  });
  const fileForgotten = forgetIndexedFile({
    projectId: validProjectId,
    fileName: validFileName,
  });

  return {
    projectId: validProjectId,
    fileName: validFileName,
    deletedChunks,
    fileForgotten,
  };
};

module.exports = { indexFile, indexFiles, deleteIndexedFile };

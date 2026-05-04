const { ChromaClient } = require("chromadb");
const config = require("../config");
const { logger } = require("../utils/logger");

const client = new ChromaClient({
  host: config.chroma.host,
  port: config.chroma.port,
  ssl: config.chroma.ssl,
});

let collection;

const init = async () => {
  collection = await client.getOrCreateCollection({
    name: config.chroma.collectionName,
    embeddingFunction: null,
  });

  logger.info("Chroma collection ready", {
    collection: config.chroma.collectionName,
    host: config.chroma.host,
    port: config.chroma.port,
  });
};

const ensureCollection = () => {
  if (!collection) {
    throw new Error("Vector collection is not initialized");
  }
};

const addDocuments = async (docs) => {
  ensureCollection();

  const validDocs = docs.filter(
    (d) => d.embedding && Array.isArray(d.embedding) && d.embedding.length > 0
  );

  if (validDocs.length === 0) {
    throw new Error("No valid embeddings to store");
  }

  await collection.upsert({
    ids: validDocs.map((d) => d.id),
    embeddings: validDocs.map((d) => d.embedding),
    documents: validDocs.map((d) => d.text),
    metadatas: validDocs.map((d) => d.metadata),
  });
};

const deleteFileChunks = async ({ projectId, fileName }) => {
  ensureCollection();

  const result = await collection.delete({
    where: {
      $and: [{ projectId }, { fileName }],
    },
  });

  logger.info("Deleted old file chunks", {
    projectId,
    fileName,
    deleted: result?.deleted || 0,
  });
};

const deleteProjectChunks = async (projectId) => {
  ensureCollection();

  const result = await collection.delete({
    where: { projectId },
  });

  logger.info("Deleted project chunks", {
    projectId,
    deleted: result?.deleted || 0,
  });

  return result?.deleted || 0;
};

const mapQueryRows = (results) => {
  const ids = results.ids?.[0] || [];
  const documents = results.documents?.[0] || [];
  const metadatas = results.metadatas?.[0] || [];
  const distances = results.distances?.[0] || [];

  return ids.map((id, index) => ({
    id,
    text: documents[index] || "",
    metadata: metadatas[index] || {},
    distance: distances[index],
  }));
};

const mapGetRows = (results) => {
  const ids = results.ids || [];
  const documents = results.documents || [];
  const metadatas = results.metadatas || [];

  return ids.map((id, index) => ({
    id,
    text: documents[index] || "",
    metadata: metadatas[index] || {},
    distance: undefined,
  }));
};

const queryByType = async ({ embedding, projectId, type, limit }) => {
  ensureCollection();

  const results = await collection.query({
    queryEmbeddings: [embedding],
    nResults: limit,
    where: {
      $and: [{ projectId }, { type }],
    },
    include: ["documents", "metadatas", "distances"],
  });

  return mapQueryRows(results);
};

const queryDocuments = async (embedding, projectId, options = {}) => {
  const [codeDocs, importDocs] = await Promise.all([
    queryByType({
      embedding,
      projectId,
      type: "code",
      limit: options.codeLimit || config.retrieval.codeChunks,
    }),
    queryByType({
      embedding,
      projectId,
      type: "import",
      limit: options.importLimit || config.retrieval.importChunks,
    }),
  ]);

  return [...importDocs, ...codeDocs];
};

const getFileDocuments = async ({ projectId, fileName, limit }) => {
  ensureCollection();

  const results = await collection.get({
    where: {
      $and: [{ projectId }, { fileName }],
    },
    include: ["documents", "metadatas"],
  });

  return mapGetRows(results)
    .sort((a, b) => {
      const typeScore = (chunk) => (chunk.metadata.type === "import" ? 0 : 1);
      const typeCompare = typeScore(a) - typeScore(b);
      if (typeCompare !== 0) return typeCompare;
      return Number(a.metadata.startLine || 0) - Number(b.metadata.startLine || 0);
    })
    .slice(0, limit);
};

const getDocumentsForFiles = async ({ projectId, fileNames, limitPerFile }) => {
  ensureCollection();

  const uniqueFileNames = Array.from(new Set(fileNames.filter(Boolean)));
  const groups = await Promise.all(
    uniqueFileNames.map((fileName) =>
      getFileDocuments({
        projectId,
        fileName,
        limit: limitPerFile,
      })
    )
  );

  return groups.flat();
};

module.exports = {
  init,
  addDocuments,
  deleteFileChunks,
  deleteProjectChunks,
  getDocumentsForFiles,
  queryDocuments,
};

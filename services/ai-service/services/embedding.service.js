const config = require("../config");
const fs = require("fs");
const path = require("path");
const { sha1 } = require("../utils/hash");
const { logger } = require("../utils/logger");

const dataDirectory = path.join(__dirname, "..", "data");
const cacheFile = path.join(dataDirectory, "embedding-cache.json");
const embeddingCache = new Map();
let cacheDirty = false;

const ensureDataDirectory = () => {
  fs.mkdirSync(dataDirectory, { recursive: true });
};

const isValidEmbedding = (embedding) =>
  Array.isArray(embedding) &&
  embedding.length === config.embeddings.dimensions &&
  embedding.every((value) => typeof value === "number" && Number.isFinite(value));

const loadCache = () => {
  ensureDataDirectory();
  if (!fs.existsSync(cacheFile)) return;

  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    Object.entries(parsed.embeddings || {}).forEach(([key, embedding]) => {
      if (isValidEmbedding(embedding)) embeddingCache.set(key, embedding);
    });
    logger.info("Local embedding cache loaded", { embeddings: embeddingCache.size });
  } catch (error) {
    logger.warn("Could not load local embedding cache", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const persistCache = () => {
  if (!cacheDirty) return;
  ensureDataDirectory();

  fs.writeFileSync(
    cacheFile,
    JSON.stringify({
      provider: config.embeddings.provider,
      model: config.embeddings.model,
      dimensions: config.embeddings.dimensions,
      embeddings: Object.fromEntries(embeddingCache.entries()),
    })
  );
  cacheDirty = false;
};

const prepareEmbeddingInput = (text) => {
  if (text.length <= config.ingestion.maxEmbeddingChars) {
    return text;
  }

  return text.slice(0, config.ingestion.maxEmbeddingChars);
};

const tokenize = (text = "") =>
  String(text)
    .toLowerCase()
    .split(/[^a-z0-9_.$:/-]+/)
    .filter((token) => token.length > 1);

const hashToIndex = (token) =>
  Number.parseInt(sha1(token).slice(0, 8), 16) % config.embeddings.dimensions;

const hashToSign = (token) =>
  Number.parseInt(sha1(`sign:${token}`).slice(0, 2), 16) % 2 === 0 ? 1 : -1;

const createLocalEmbedding = (input) => {
  const vector = new Array(config.embeddings.dimensions).fill(0);
  const tokens = tokenize(input);

  tokens.forEach((token) => {
    const index = hashToIndex(token);
    vector[index] += hashToSign(token);

    if (token.includes("/")) {
      token.split("/").forEach((part) => {
        if (part.length > 1) vector[hashToIndex(part)] += 0.35 * hashToSign(part);
      });
    }
  });

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return null;

  return vector.map((value) => Number((value / magnitude).toFixed(6)));
};

const createCacheKey = (input) =>
  sha1(`${config.embeddings.model}:${config.embeddings.dimensions}:${prepareEmbeddingInput(input)}`);

const embedTexts = async (texts) => {
  const results = texts.map((text) => {
    const input = prepareEmbeddingInput(text || "");
    const key = createCacheKey(input);
    const cached = embeddingCache.get(key);

    if (cached) return cached;

    const embedding = createLocalEmbedding(input);
    if (embedding) {
      embeddingCache.set(key, embedding);
      cacheDirty = true;
    }

    return embedding;
  });

  persistCache();
  return results;
};

const embedText = async (text) => {
  const [embedding] = await embedTexts([text]);
  return embedding || null;
};

loadCache();

module.exports = { embedText, embedTexts, isValidEmbedding, prepareEmbeddingInput };

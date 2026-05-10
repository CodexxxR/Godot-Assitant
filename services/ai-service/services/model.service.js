const fs = require("fs");
const path = require("path");
const config = require("../config");
const { logger } = require("../utils/logger");

const dataDirectory = path.join(__dirname, "..", "data");
const settingsFile = path.join(dataDirectory, "openrouter-settings.json");
const DEFAULT_FREE_MODEL = "qwen/qwen3-coder:free";
const CATALOG_LIMITATIONS = [
  "Only OpenRouter models with zero prompt and completion pricing are listed.",
  "Free routes can be rate limited, throttled, temporarily unavailable, or moved by OpenRouter/providers.",
  "Long answers may stop early on some free routes; automatic continuation guards against repeated partial output.",
  "Free models vary widely in coding quality, context handling, moderation, and tool support.",
];
const PREFERRED_FREE_MODELS = [
  "qwen/qwen3-coder:free",
  "openrouter/free",
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-20b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "z-ai/glm-4.5-air:free",
  "minimax/minimax-m2.5:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "poolside/laguna-m.1:free",
  "poolside/laguna-xs.2:free",
];

let freeModelCache = {
  fetchedAt: 0,
  source: "Bundled free fallback",
  models: [],
};

const ensureDataDirectory = () => {
  fs.mkdirSync(dataDirectory, { recursive: true });
};

const isSafeModelName = (model = "") => /^[a-zA-Z0-9._:/-]+$/.test(model);
const isConfiguredFreeModelName = (model = "") =>
  model.endsWith(":free") || model === "openrouter/free";
const getPreferredRank = (name) => {
  const index = PREFERRED_FREE_MODELS.indexOf(name);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const formatTokenCount = (value) => {
  if (!Number.isFinite(value) || value <= 0) return "provider limited";
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M tokens`;
  if (value >= 1000) return `${Math.round(value / 1000)}K tokens`;
  return `${value} tokens`;
};

const titleFromModelId = (name) =>
  name
    .split("/")
    .at(-1)
    .replace(/:free$/, "")
    .replace(/[-_.]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const firstSentence = (text = "") => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentence = clean.match(/^(.{40,220}?[.!?])\s/)?.[1];
  return sentence || clean.slice(0, 220);
};

const inferFamily = (model) => {
  const text = `${model.id || ""} ${model.name || ""} ${model.description || ""}`;
  if (/coder|coding|software|code generation|agent/i.test(text)) return "Free coding model";
  if (/reason|thinking/i.test(text)) return "Free reasoning model";
  if (/vision|image|video|audio|ocr|multimodal/i.test(text)) return "Free multimodal model";
  return "Free general model";
};

const hasZeroPrice = (price) => price !== undefined && Number(price) === 0;
const isFreeOpenRouterModel = (model) =>
  hasZeroPrice(model?.pricing?.prompt) && hasZeroPrice(model?.pricing?.completion);

const toCatalogModel = (model) => {
  const contextLength = Number(model.context_length || model.top_provider?.context_length || 0);
  const maxCompletionTokens = Number(model.top_provider?.max_completion_tokens || 0);
  const modality = model.architecture?.modality || "text->text";
  const description = firstSentence(model.description);

  return {
    name: model.id,
    title: model.name || titleFromModelId(model.id),
    family: inferFamily(model),
    useCase:
      description ||
      "Free OpenRouter route for Godot assistance. Verify generated code before saving.",
    isFree: true,
    pricingLabel: "Free: $0 prompt / $0 completion",
    contextLength,
    maxCompletionTokens,
    modality,
    limitations: [
      `Context window: ${formatTokenCount(contextLength)}; max output: ${formatTokenCount(maxCompletionTokens)}.`,
      "Free-tier availability, speed, and rate limits are controlled by OpenRouter and the upstream provider.",
    ],
  };
};

const fallbackCatalogModels = () =>
  config.openRouter.modelCatalog.map((name) =>
    toCatalogModel({
      id: name,
      name: `${titleFromModelId(name)} (free)`,
      description:
        "Bundled free OpenRouter fallback model. Refresh the catalog for live metadata from OpenRouter.",
      context_length: 0,
      architecture: { modality: "text->text" },
      pricing: { prompt: "0", completion: "0" },
      top_provider: { max_completion_tokens: 0 },
    })
  );

const fetchOpenRouterFreeModels = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(config.openRouter.requestTimeoutMs, 30000)
  );

  try {
    const headers = {
      "Content-Type": "application/json",
      "HTTP-Referer": config.openRouter.referer,
      "X-Title": config.openRouter.title,
    };
    if (config.openRouter.apiKey) {
      headers.Authorization = `Bearer ${config.openRouter.apiKey}`;
    }

    const res = await fetch(`${config.openRouter.baseUrl}/models`, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenRouter model catalog failed (${res.status}): ${await res.text()}`);
    }

    const payload = await res.json();
    const models = (payload.data || [])
      .filter(isFreeOpenRouterModel)
      .map(toCatalogModel)
      .sort((a, b) => {
        const rankDifference = getPreferredRank(a.name) - getPreferredRank(b.name);
        if (rankDifference !== 0) return rankDifference;
        return a.title.localeCompare(b.title);
      });

    if (models.length === 0) {
      throw new Error("OpenRouter returned no zero-price models");
    }

    freeModelCache = {
      fetchedAt: Date.now(),
      source: "Live OpenRouter free catalog",
      models,
    };
  } finally {
    clearTimeout(timeout);
  }

  return freeModelCache;
};

const getFreeModelCatalog = async () => {
  const isFresh =
    freeModelCache.models.length > 0 &&
    Date.now() - freeModelCache.fetchedAt < config.openRouter.modelCatalogCacheMs;
  if (isFresh) return freeModelCache;

  try {
    return await fetchOpenRouterFreeModels();
  } catch (error) {
    logger.warn("Using bundled free OpenRouter model fallback", {
      message: error instanceof Error ? error.message : String(error),
    });
    freeModelCache = {
      fetchedAt: Date.now(),
      source: "Bundled free fallback",
      models: fallbackCatalogModels(),
    };
    return freeModelCache;
  }
};

const ensureActiveModelIsFree = (models) => {
  const freeNames = new Set(models.map((model) => model.name));
  if (freeNames.has(config.openRouter.chatModel)) return config.openRouter.chatModel;

  const fallback =
    models.find((model) => model.name === DEFAULT_FREE_MODEL) || models[0];
  config.openRouter.chatModel = fallback.name;

  if (!process.env.OPENROUTER_CHAT_MODEL) persistModelSettings();

  logger.warn("Switched to a free OpenRouter model", {
    model: fallback.name,
  });

  return fallback.name;
};

const readModelSettings = () => {
  ensureDataDirectory();
  if (process.env.OPENROUTER_CHAT_MODEL) {
    if (!isConfiguredFreeModelName(config.openRouter.chatModel)) {
      logger.warn("Ignoring non-free OPENROUTER_CHAT_MODEL", {
        model: config.openRouter.chatModel,
        fallback: DEFAULT_FREE_MODEL,
      });
      config.openRouter.chatModel = DEFAULT_FREE_MODEL;
      return;
    }

    logger.info("Using OpenRouter chat model from environment", {
      model: config.openRouter.chatModel,
    });
    return;
  }

  if (!fs.existsSync(settingsFile)) return;

  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    if (isSafeModelName(settings.chatModel) && isConfiguredFreeModelName(settings.chatModel)) {
      config.openRouter.chatModel = settings.chatModel;
      logger.info("Loaded OpenRouter chat model selection", {
        model: settings.chatModel,
      });
    } else if (settings.chatModel) {
      logger.warn("Ignoring saved non-free OpenRouter model selection", {
        model: settings.chatModel,
        fallback: DEFAULT_FREE_MODEL,
      });
      config.openRouter.chatModel = DEFAULT_FREE_MODEL;
    }
  } catch (error) {
    logger.warn("Could not load OpenRouter settings", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const persistModelSettings = () => {
  ensureDataDirectory();
  fs.writeFileSync(
    settingsFile,
    JSON.stringify(
      {
        chatModel: config.openRouter.chatModel,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
};

const requireModelName = (model) => {
  if (typeof model !== "string" || !model.trim() || !isSafeModelName(model.trim())) {
    const error = new Error("A valid OpenRouter model id is required");
    error.statusCode = 400;
    throw error;
  }

  return model.trim();
};

const listOpenRouterModels = async () => {
  const catalog = await getFreeModelCatalog();
  const activeModel = ensureActiveModelIsFree(catalog.models);

  return {
    activeModel,
    embeddingModel: config.embeddings.model,
    provider: "OpenRouter",
    apiKeyConfigured: Boolean(config.openRouter.apiKey),
    modelPolicy: "free-only",
    source: catalog.source,
    updatedAt: new Date(catalog.fetchedAt).toISOString(),
    limitations: CATALOG_LIMITATIONS,
    models: catalog.models,
  };
};

const getAvailableFreeModelIds = async () => {
  const catalog = await getFreeModelCatalog();
  ensureActiveModelIsFree(catalog.models);
  return catalog.models.map((model) => model.name);
};

const selectChatModel = async (model) => {
  const validModel = requireModelName(model);
  const catalog = await getFreeModelCatalog();
  const selectedModel = catalog.models.find((entry) => entry.name === validModel);

  if (!selectedModel) {
    const error = new Error(
      "Only free OpenRouter models can be selected. Refresh the model list and choose a model marked Free."
    );
    error.statusCode = 400;
    throw error;
  }

  config.openRouter.chatModel = validModel;

  if (!config.openRouter.modelCatalog.includes(validModel) && selectedModel.isFree) {
    config.openRouter.modelCatalog = [validModel, ...config.openRouter.modelCatalog];
  }

  persistModelSettings();
  logger.info("OpenRouter chat model selected", { model: validModel });
  return {
    activeModel: validModel,
  };
};

readModelSettings();

module.exports = {
  getAvailableFreeModelIds,
  listOpenRouterModels,
  selectChatModel,
};

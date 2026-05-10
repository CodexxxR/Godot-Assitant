const config = {
  port: Number(process.env.PORT || 3001),
  chroma: {
    host: process.env.CHROMA_HOST || "localhost",
    port: Number(process.env.CHROMA_PORT || 8000),
    ssl: process.env.CHROMA_SSL === "true",
    collectionName: process.env.CHROMA_COLLECTION || "godot_code_chunks",
  },
  openRouter: {
    baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "",
    chatModel:
      process.env.OPENROUTER_CHAT_MODEL || "qwen/qwen3-coder:free",
    requestTimeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS || 120000),
    streamIdleTimeoutMs: Number(process.env.OPENROUTER_STREAM_IDLE_TIMEOUT_MS || 45000),
    streamTotalTimeoutMs: Number(process.env.OPENROUTER_STREAM_TOTAL_TIMEOUT_MS || 180000),
    maxTokens: Number(process.env.OPENROUTER_MAX_TOKENS || 4096),
    maxContinuations: Number(process.env.OPENROUTER_MAX_CONTINUATIONS || 2),
    freeFallbackAttempts: Number(process.env.OPENROUTER_FREE_FALLBACK_ATTEMPTS || 6),
    modelCatalogCacheMs: Number(process.env.OPENROUTER_MODEL_CATALOG_CACHE_MS || 300000),
    referer: process.env.OPENROUTER_HTTP_REFERER || "http://localhost:5173",
    title: process.env.OPENROUTER_APP_TITLE || "Godot Assistant",
    roles: {
      planner: {
        modelId: process.env.OPENROUTER_PLANNER_MODEL || "openai/gpt-oss-120b:free",
        temperature: Number(process.env.OPENROUTER_PLANNER_TEMPERATURE || 0.12),
        maxTokens: Number(process.env.OPENROUTER_PLANNER_MAX_TOKENS || process.env.OPENROUTER_MAX_TOKENS || 4096),
        purpose:
          "Create strict Godot 4.6 project plans and structural scene manifests from user prompts.",
        jsonRequired: true,
        fallbackModels: (
          process.env.OPENROUTER_PLANNER_FALLBACK_MODELS ||
          "qwen/qwen3-next-80b-a3b-instruct:free,z-ai/glm-4.5-air:free,openai/gpt-oss-20b:free,minimax/minimax-m2.5:free,openrouter/free"
        )
          .split(",")
          .map((model) => model.trim())
          .filter(Boolean),
      },
      coder: {
        modelId: process.env.OPENROUTER_CODER_MODEL || "qwen/qwen3-coder:free",
        temperature: Number(process.env.OPENROUTER_CODER_TEMPERATURE || 0.16),
        maxTokens: Number(process.env.OPENROUTER_CODER_MAX_TOKENS || process.env.OPENROUTER_MAX_TOKENS || 4096),
        purpose:
          "Generate Godot 4.6-compatible GDScript and support files from approved manifests.",
        jsonRequired: true,
        fallbackModels: (
          process.env.OPENROUTER_CODER_FALLBACK_MODELS ||
          "qwen/qwen3-next-80b-a3b-instruct:free,openai/gpt-oss-120b:free,z-ai/glm-4.5-air:free,openai/gpt-oss-20b:free,minimax/minimax-m2.5:free,openrouter/free"
        )
          .split(",")
          .map((model) => model.trim())
          .filter(Boolean),
      },
      reviewer: {
        modelId: process.env.OPENROUTER_REVIEWER_MODEL || "z-ai/glm-4.5-air:free",
        temperature: Number(process.env.OPENROUTER_REVIEWER_TEMPERATURE || 0.05),
        maxTokens: Number(process.env.OPENROUTER_REVIEWER_MAX_TOKENS || process.env.OPENROUTER_MAX_TOKENS || 4096),
        purpose:
          "Review generated Godot 4.6 manifests and files for correctness before writing projects.",
        jsonRequired: true,
        fallbackModels: (
          process.env.OPENROUTER_REVIEWER_FALLBACK_MODELS ||
          "openai/gpt-oss-20b:free,openai/gpt-oss-120b:free,qwen/qwen3-next-80b-a3b-instruct:free,openrouter/free"
        )
          .split(",")
          .map((model) => model.trim())
          .filter(Boolean),
      },
      fixer: {
        modelId: process.env.OPENROUTER_FIXER_MODEL || "qwen/qwen3-coder:free",
        temperature: Number(process.env.OPENROUTER_FIXER_TEMPERATURE || 0.08),
        maxTokens: Number(process.env.OPENROUTER_FIXER_MAX_TOKENS || process.env.OPENROUTER_MAX_TOKENS || 4096),
        purpose:
          "Repair only affected generated Godot 4.6 files or scene manifests based on validation errors.",
        jsonRequired: true,
        fallbackModels: (
          process.env.OPENROUTER_FIXER_FALLBACK_MODELS ||
          "qwen/qwen3-next-80b-a3b-instruct:free,openai/gpt-oss-120b:free,z-ai/glm-4.5-air:free,openai/gpt-oss-20b:free,minimax/minimax-m2.5:free,openrouter/free"
        )
          .split(",")
          .map((model) => model.trim())
          .filter(Boolean),
      },
    },
    imagePlannerModels: (
      process.env.OPENROUTER_IMAGE_PLANNER_MODELS ||
      "nvidia/nemotron-nano-12b-v2-vl:free,google/gemma-3-27b-it:free,google/gemma-3-12b-it:free,openrouter/free"
    )
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
    modelCatalog: (
      process.env.OPENROUTER_MODEL_CATALOG ||
      [
        "baidu/qianfan-ocr-fast:free",
        "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
        "google/gemma-3-12b-it:free",
        "google/gemma-3-27b-it:free",
        "google/gemma-3-4b-it:free",
        "google/gemma-3n-e2b-it:free",
        "google/gemma-3n-e4b-it:free",
        "google/gemma-4-26b-a4b-it:free",
        "google/gemma-4-31b-it:free",
        "inclusionai/ling-2.6-1t:free",
        "liquid/lfm-2.5-1.2b-instruct:free",
        "liquid/lfm-2.5-1.2b-thinking:free",
        "meta-llama/llama-3.2-3b-instruct:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "minimax/minimax-m2.5:free",
        "nousresearch/hermes-3-llama-3.1-405b:free",
        "nvidia/nemotron-3-nano-30b-a3b:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "nvidia/nemotron-nano-12b-v2-vl:free",
        "nvidia/nemotron-nano-9b-v2:free",
        "openai/gpt-oss-120b:free",
        "openai/gpt-oss-20b:free",
        "openrouter/free",
        "poolside/laguna-m.1:free",
        "poolside/laguna-xs.2:free",
        "qwen/qwen3-coder:free",
        "qwen/qwen3-next-80b-a3b-instruct:free",
        "tencent/hy3-preview:free",
        "z-ai/glm-4.5-air:free",
      ].join(",")
    )
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
  },
  embeddings: {
    provider: "local-hashing",
    model: "gdscript-local-hash-v1",
    dimensions: Number(process.env.LOCAL_EMBEDDING_DIMENSIONS || 384),
  },
  ingestion: {
    embeddingBatchSize: Number(process.env.EMBEDDING_BATCH_SIZE || 16),
    embeddingConcurrency: Number(process.env.EMBEDDING_CONCURRENCY || 4),
    fileIndexConcurrency: Number(process.env.FILE_INDEX_CONCURRENCY || 4),
    maxChunkChars: Number(process.env.MAX_CHUNK_CHARS || 2400),
    maxEmbeddingChars: Number(process.env.MAX_EMBEDDING_CHARS || 2400),
    maxFileChars: Number(process.env.MAX_FILE_CHARS || 500000),
  },
  retrieval: {
    candidateCodeChunks: Number(process.env.RETRIEVAL_CANDIDATE_CODE_CHUNKS || 18),
    candidateImportChunks: Number(process.env.RETRIEVAL_CANDIDATE_IMPORT_CHUNKS || 6),
    codeChunks: Number(process.env.RETRIEVAL_CODE_CHUNKS || 6),
    importChunks: Number(process.env.RETRIEVAL_IMPORT_CHUNKS || 2),
    maxContextChars: Number(process.env.RETRIEVAL_MAX_CONTEXT_CHARS || 14000),
    relatedFileChunks: Number(process.env.RETRIEVAL_RELATED_FILE_CHUNKS || 3),
  },
  godot: {
    targetVersion: process.env.GODOT_TARGET_VERSION || "4.6",
    bin: process.env.GODOT_BIN || "",
    projectPath: process.env.GODOT_PROJECT_PATH || "",
    enableCliValidation: process.env.ENABLE_GODOT_CLI_VALIDATION === "true",
    repairIterations: Number(process.env.GODOT_GENERATION_REPAIR_ITERATIONS || 2),
  },
};

module.exports = config;

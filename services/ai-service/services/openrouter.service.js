const config = require("../config");
const { logger } = require("../utils/logger");
const { getAvailableFreeModelIds } = require("./model.service");
const { getModelRole, getRoleModelsToTry, isFreeModelId } = require("./generation/model-roles");

const requireApiKey = () => {
  if (!config.openRouter.apiKey) {
    const error = new Error(
      "OPENROUTER_API_KEY is required before the assistant can generate code."
    );
    error.statusCode = 400;
    throw error;
  }
};

const withTimeout = async (request) => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.openRouter.requestTimeoutMs
  );

  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const parseStreamingLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) return null;

  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return null;

  return JSON.parse(payload);
};

const buildMessages = ({ prompt, system, messages }) => {
  if (Array.isArray(messages) && messages.length > 0) return messages;

  return [
    {
      role: "system",
      content:
        system ||
        "You are a senior Godot engineer. Be precise, practical, and code-first.",
    },
    {
      role: "user",
      content: prompt,
    },
  ];
};

const parseOpenRouterErrorDetail = (detail = "") => {
  try {
    return JSON.parse(detail);
  } catch {
    return undefined;
  }
};

const getOpenRouterErrorMessage = (detail = "") => {
  const parsed = parseOpenRouterErrorDetail(detail);
  if (typeof parsed?.error === "string") return parsed.error;
  return (
    parsed?.error?.metadata?.raw ||
    parsed?.error?.message ||
    detail ||
    "OpenRouter generation failed"
  );
};

const isSpendLimitError = ({ status, detail }) => {
  const message = getOpenRouterErrorMessage(detail);
  return (
    status === 402 ||
    /spend limit|spending limit|usd spend|payment required/i.test(message)
  );
};

const shouldTryFreeFallback = ({ status, detail }) =>
  status === 429 || /rate[- ]limited|temporarily unavailable|overloaded/i.test(detail);

const createOpenRouterError = ({ status, detail, model, attemptedModels }) => {
  const message = getOpenRouterErrorMessage(detail);
  const isSpendLimit = isSpendLimitError({ status, detail });
  const error = new Error(
    isSpendLimit
      ? `OpenRouter API key spend limit exceeded. Free models still require an OpenRouter key that is allowed to make requests. Increase or reset this key's USD spend limit in OpenRouter, switch to another OPENROUTER_API_KEY, or create a new key, then restart the app.`
      : `OpenRouter generation failed for ${model} (${status}): ${message}`
  );
  error.statusCode = isSpendLimit ? 402 : status === 429 ? 429 : 502;
  error.code = isSpendLimit ? "OPENROUTER_SPEND_LIMIT_EXCEEDED" : undefined;
  error.openRouterStatus = status;
  error.openRouterModel = model;
  error.attemptedModels = attemptedModels;
  error.detail = detail;
  return error;
};

const createStreamTimeoutError = ({ model, role, elapsedMs, timeoutMs }) => {
  const error = new Error(
    `OpenRouter stream timed out for ${model}${role ? ` (${role})` : ""} after ${Math.round(
      elapsedMs / 1000
    )}s. The free provider may be overloaded; try again or choose another free model.`
  );
  error.statusCode = 504;
  error.code = "OPENROUTER_STREAM_TIMEOUT";
  error.openRouterModel = model;
  error.openRouterRole = role;
  error.timeoutMs = timeoutMs;
  return error;
};

const readStreamChunk = async ({ reader, model, role, startedAt }) => {
  const elapsedMs = Date.now() - startedAt;
  const remainingTotalMs = config.openRouter.streamTotalTimeoutMs - elapsedMs;
  const timeoutMs = Math.min(config.openRouter.streamIdleTimeoutMs, remainingTotalMs);

  if (timeoutMs <= 0) {
    throw createStreamTimeoutError({
      model,
      role,
      elapsedMs,
      timeoutMs: config.openRouter.streamTotalTimeoutMs,
    });
  }

  let timeout;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reader.cancel().catch(() => {});
          reject(
            createStreamTimeoutError({
              model,
              role,
              elapsedMs: Date.now() - startedAt,
              timeoutMs,
            })
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const getModelsToTry = async (roleName, modelCandidates) => {
  if (Array.isArray(modelCandidates) && modelCandidates.length > 0) {
    return Array.from(new Set(modelCandidates.map(String).map((model) => model.trim())))
      .filter(Boolean)
      .filter(isFreeModelId);
  }

  if (roleName) {
    const roleModels = getRoleModelsToTry(roleName);
    if (roleModels.length > 0) return roleModels;
  }

  const selectedModel = config.openRouter.chatModel;
  const models = [selectedModel];

  try {
    const freeModels = await getAvailableFreeModelIds();
    for (const model of freeModels) {
      if (!models.includes(model)) models.push(model);
    }
  } catch (error) {
    logger.warn("Could not load free OpenRouter fallback models", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return models.slice(0, Math.max(1, config.openRouter.freeFallbackAttempts));
};

const openChatCompletionStream = async ({
  model,
  prompt,
  system,
  messages,
  temperature = 0.18,
  maxTokens = config.openRouter.maxTokens,
}) =>
  withTimeout((signal) =>
    fetch(`${config.openRouter.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openRouter.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.openRouter.referer,
        "X-Title": config.openRouter.title,
      },
      body: JSON.stringify({
        model,
        messages: buildMessages({ prompt, system, messages }),
        stream: true,
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    })
  );

const getOpenRouterResponse = async ({ prompt, system, messages, role, models }) => {
  const attemptedModels = [];
  let lastError;
  const roleConfig = role ? getModelRole(role) : null;
  const temperature = roleConfig?.temperature ?? 0.18;
  const maxTokens = roleConfig?.maxTokens || config.openRouter.maxTokens;

  for (const model of await getModelsToTry(role, models)) {
    attemptedModels.push(model);
    const res = await openChatCompletionStream({
      model,
      prompt,
      system,
      messages,
      temperature,
      maxTokens,
    });

    if (res.ok && res.body) {
      const requestedModel = models?.[0] || roleConfig?.modelId || config.openRouter.chatModel;
      if (model !== requestedModel) {
        logger.warn("Using free OpenRouter fallback model", {
          role,
          requestedModel,
          fallbackModel: model,
        });
      }
      return { res, model };
    }

    const detail = await res.text();
    lastError = createOpenRouterError({
      status: res.status,
      detail,
      model,
      attemptedModels: [...attemptedModels],
    });

    if (!shouldTryFreeFallback({ status: res.status, detail })) {
      throw lastError;
    }

    logger.warn("Free OpenRouter model unavailable, trying fallback", {
      model,
      status: res.status,
      message: getOpenRouterErrorMessage(detail),
    });
  }

  if (lastError) {
    lastError.message =
      `All tried free OpenRouter models are currently unavailable. ` +
      `Attempted: ${attemptedModels.join(", ")}. Last error: ${lastError.message}`;
    throw lastError;
  }

  throw new Error("No free OpenRouter models are available to try.");
};

const streamGenerate = async ({
  prompt,
  system,
  messages,
  role,
  models,
  onToken,
  onModelSwitch,
}) => {
  requireApiKey();
  let finishReason = null;
  const roleConfig = role ? getModelRole(role) : null;
  const requestedModel = models?.[0] || roleConfig?.modelId || config.openRouter.chatModel;
  const { res, model } = await getOpenRouterResponse({ prompt, system, messages, role, models });
  if (model !== requestedModel) {
    onModelSwitch?.({
      from: requestedModel,
      to: model,
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const startedAt = Date.now();

  while (true) {
    const { done, value } = await readStreamChunk({
      reader,
      model,
      role,
      startedAt,
    });
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const parsed = parseStreamingLine(line);
      const choice = parsed?.choices?.[0];
      const token = choice?.delta?.content;
      if (token) onToken(token);
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.native_finish_reason) finishReason = choice.native_finish_reason;
    }
  }

  if (buffer.trim()) {
    const parsed = parseStreamingLine(buffer);
    const choice = parsed?.choices?.[0];
    const token = choice?.delta?.content;
    if (token) onToken(token);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (choice?.native_finish_reason) finishReason = choice.native_finish_reason;
  }

  return { finishReason, model };
};

module.exports = {
  createOpenRouterError,
  getOpenRouterErrorMessage,
  streamGenerate,
};

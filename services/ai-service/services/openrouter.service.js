const config = require("../config");
const { logger } = require("../utils/logger");
const { getAvailableFreeModelIds } = require("./model.service");

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
  return (
    parsed?.error?.metadata?.raw ||
    parsed?.error?.message ||
    detail ||
    "OpenRouter generation failed"
  );
};

const shouldTryFreeFallback = ({ status, detail }) =>
  status === 429 || /rate[- ]limited|temporarily unavailable|overloaded/i.test(detail);

const createOpenRouterError = ({ status, detail, model, attemptedModels }) => {
  const message = getOpenRouterErrorMessage(detail);
  const error = new Error(
    `OpenRouter generation failed for ${model} (${status}): ${message}`
  );
  error.statusCode = status === 429 ? 429 : 502;
  error.openRouterStatus = status;
  error.openRouterModel = model;
  error.attemptedModels = attemptedModels;
  error.detail = detail;
  return error;
};

const getModelsToTry = async () => {
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

const openChatCompletionStream = async ({ model, prompt, system, messages }) =>
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
        temperature: 0.18,
        max_tokens: config.openRouter.maxTokens,
      }),
      signal,
    })
  );

const getOpenRouterResponse = async ({ prompt, system, messages }) => {
  const attemptedModels = [];
  let lastError;

  for (const model of await getModelsToTry()) {
    attemptedModels.push(model);
    const res = await openChatCompletionStream({ model, prompt, system, messages });

    if (res.ok && res.body) {
      if (model !== config.openRouter.chatModel) {
        logger.warn("Using free OpenRouter fallback model", {
          requestedModel: config.openRouter.chatModel,
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

const streamGenerate = async ({ prompt, system, messages, onToken, onModelSwitch }) => {
  requireApiKey();
  let finishReason = null;
  const { res, model } = await getOpenRouterResponse({ prompt, system, messages });
  if (model !== config.openRouter.chatModel) {
    onModelSwitch?.({
      from: config.openRouter.chatModel,
      to: model,
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
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

module.exports = { streamGenerate };

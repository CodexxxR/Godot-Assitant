const formatPayload = (payload) => {
  if (!payload) return "";

  if (typeof payload === "string") {
    return ` ${payload}`;
  }

  try {
    return ` ${JSON.stringify(payload)}`;
  } catch {
    return " [unserializable payload]";
  }
};

const log = (level, message, payload) => {
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}] ${message}${formatPayload(payload)}`);
};

const logger = {
  info: (message, payload) => log("log", message, payload),
  warn: (message, payload) => log("warn", message, payload),
  error: (message, payload) => log("error", message, payload),
};

module.exports = { logger };

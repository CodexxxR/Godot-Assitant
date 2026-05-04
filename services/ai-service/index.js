const express = require("express");
const cors = require("cors");
const config = require("./config");
const { init } = require("./services/vector.service");
const projectRoutes = require("./routes/project.routes");
const uploadRoutes = require("./routes/upload.routes");
const chatRoutes = require("./routes/chat.routes");
const modelRoutes = require("./routes/model.routes");
const { logger } = require("./utils/logger");

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    openRouterModel: config.openRouter.chatModel,
    openRouterConfigured: Boolean(config.openRouter.apiKey),
    embeddingModel: config.embeddings.model,
    vectorStore: `${config.chroma.host}:${config.chroma.port}`,
  });
});

app.use("/project", projectRoutes);
app.use("/upload", uploadRoutes);
app.use("/chat", chatRoutes);
app.use("/models", modelRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  logger.error(error.message || "Unhandled error", {
    statusCode,
    stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
  });

  res.status(statusCode).json({
    error: statusCode >= 500 ? "Internal server error" : error.message,
  });
});

const start = async () => {
  await init();

  app.listen(config.port, () => {
    logger.info(`AI service running on http://localhost:${config.port}`);
  });
};

start().catch((error) => {
  logger.error("Failed to start AI service", {
    message: error.message,
  });
  process.exit(1);
});

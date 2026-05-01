import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateReply, getConfiguredModels, getConfiguredProvider, isModelSwitchEnabled, resolveModel } from "./llmClient.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const provider = getConfiguredProvider(process.env);
const models = getConfiguredModels(process.env, provider);
const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(currentDir, "..", "frontend");

function normalizeOutputFormat(value) {
  return value === "rich" ? "rich" : "plain";
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .trim();
}

app.use(
  cors({
    origin: allowedOrigin === "*" ? true : allowedOrigin,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  })
);
app.use(express.json({ limit: "32kb" }));
app.use(express.static(frontendDir));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/models", (_request, response) => {
  response.json({
    provider,
    models,
    selectedModel: models[0],
    modelSwitchEnabled: isModelSwitchEnabled(process.env)
  });
});

app.post("/api/chat", async (request, response) => {
  const { message, history, model: requestedModel, outputFormat: requestedOutputFormat } = request.body ?? {};
  const outputFormat = normalizeOutputFormat(requestedOutputFormat);

  if (typeof message !== "string" || !message.trim()) {
    response.status(400).json({ error: "message is required" });
    return;
  }

  if (message.length > 4000) {
    response.status(400).json({ error: "message is too long" });
    return;
  }

  const model = resolveModel(process.env, requestedModel, provider);
  const messages = [
    {
      role: "system",
      content: "You are a helpful classroom AI assistant. Answer concisely in Japanese unless the user asks otherwise."
    },
    ...(Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              typeof item.role === "string" &&
              typeof item.content === "string" &&
              (item.role === "user" || item.role === "assistant")
          )
          .map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }))
      : []),
    {
      role: "user",
      content: message.trim()
    }
  ];

  try {
    const reply = await generateReply({ env: process.env, messages, model });
    response.json({
      reply: outputFormat === "plain" ? stripMarkdown(reply) : reply,
      outputFormat,
      model,
      provider
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "API request failed" });
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Unexpected server error" });
});

app.listen(port, () => {
  console.log(`AI Chat UI server running at http://localhost:${port}`);
});

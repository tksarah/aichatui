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
const configuredHistoryTtlMinutes = Number(process.env.CHAT_HISTORY_TTL_MINUTES || 30);
const historyTtlMinutes = Number.isFinite(configuredHistoryTtlMinutes) && configuredHistoryTtlMinutes > 0 ? configuredHistoryTtlMinutes : 30;
const historyTtlMs = historyTtlMinutes * 60 * 1000;
const historyCleanupIntervalMs = Math.max(60 * 1000, Math.min(historyTtlMs, 10 * 60 * 1000));
const sessionArchiveLimit = 12;
const configuredHistoryVisibleCount = Number(process.env.SESSION_HISTORY_VISIBLE_COUNT || 10);
const historyVisibleCount = Number.isFinite(configuredHistoryVisibleCount) && configuredHistoryVisibleCount > 0 ? Math.floor(configuredHistoryVisibleCount) : 10;
const chatHistoryStore = new Map();

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

function createSession() {
  const now = Date.now();
  return {
    id: `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "新しいチャット",
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function normalizeSession(session) {
  if (!session || typeof session.id !== "string" || !Array.isArray(session.messages)) {
    return null;
  }

  const messages = session.messages
    .filter(
      (message) =>
        message &&
        typeof message.role === "string" &&
        typeof message.content === "string" &&
        (message.role === "user" || message.role === "assistant" || message.role === "system")
    )
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
      ...(typeof message.outputFormat === "string" ? { outputFormat: message.outputFormat } : {})
    }));

  if (!messages.length) {
    return null;
  }

  const createdAt = typeof session.createdAt === "number" ? session.createdAt : Date.now();
  const updatedAt = typeof session.updatedAt === "number" ? session.updatedAt : createdAt;

  return {
    id: session.id,
    title: typeof session.title === "string" && session.title.trim() ? session.title : "新しいチャット",
    createdAt,
    updatedAt,
    messages
  };
}

function pruneArchivedSessions(sessions) {
  const threshold = Date.now() - historyTtlMs;
  return sessions
    .filter((session) => session && typeof session.updatedAt === "number" && session.updatedAt >= threshold)
    .slice(0, sessionArchiveLimit);
}

function sanitizeHistoryState(state) {
  const activeSession = normalizeSession(state?.activeSession) || createSession();
  const archivedSessions = Array.isArray(state?.archivedSessions)
    ? state.archivedSessions.map(normalizeSession).filter(Boolean)
    : [];

  return {
    activeSession,
    archivedSessions: pruneArchivedSessions(archivedSessions)
  };
}

function normalizeClientId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getHistoryClientId(request) {
  return normalizeClientId(request.query?.clientId) || normalizeClientId(request.body?.clientId);
}

function cleanupExpiredHistories() {
  const now = Date.now();
  for (const [clientId, entry] of chatHistoryStore.entries()) {
    if (!entry || entry.expiresAt <= now) {
      chatHistoryStore.delete(clientId);
    }
  }
}

function getStoredHistory(clientId) {
  const entry = chatHistoryStore.get(clientId);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    chatHistoryStore.delete(clientId);
    return null;
  }

  return entry;
}

function saveStoredHistory(clientId, payload) {
  const normalized = sanitizeHistoryState(payload);
  const now = Date.now();
  const entry = {
    ...normalized,
    savedAt: now,
    expiresAt: now + historyTtlMs
  };

  chatHistoryStore.set(clientId, entry);
  return entry;
}

setInterval(cleanupExpiredHistories, historyCleanupIntervalMs).unref?.();

app.use(
  cors({
    origin: allowedOrigin === "*" ? true : allowedOrigin,
    methods: ["GET", "POST", "PUT", "DELETE"],
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
    modelSwitchEnabled: isModelSwitchEnabled(process.env),
    historyTtlMinutes,
    historyVisibleCount
  });
});

app.get("/api/history", (request, response) => {
  const clientId = getHistoryClientId(request);
  if (!clientId) {
    response.status(400).json({ error: "clientId is required" });
    return;
  }

  const entry = getStoredHistory(clientId);
  response.json({
    ...sanitizeHistoryState(entry),
    savedAt: entry?.savedAt || null,
    historyTtlMinutes,
    historyVisibleCount
  });
});

app.put("/api/history", (request, response) => {
  const clientId = getHistoryClientId(request);
  if (!clientId) {
    response.status(400).json({ error: "clientId is required" });
    return;
  }

  const entry = saveStoredHistory(clientId, request.body);
  response.json({
    ...entry,
    historyTtlMinutes,
    historyVisibleCount
  });
});

app.delete("/api/history", (request, response) => {
  const clientId = getHistoryClientId(request);
  if (!clientId) {
    response.status(400).json({ error: "clientId is required" });
    return;
  }

  chatHistoryStore.delete(clientId);
  response.json({ ok: true });
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

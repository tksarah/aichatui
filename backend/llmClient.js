const OPENAI_API_BASE = "https://api.openai.com/v1";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function normalizeModelList(models) {
  return models
    .map((model) => model.trim())
    .filter(Boolean);
}

export function getConfiguredProvider(env) {
  const explicitProvider = (env.LLM_PROVIDER || "").trim().toLowerCase();
  if (explicitProvider === "openai" || explicitProvider === "gemini") {
    return explicitProvider;
  }

  if (env.GEMINI_API_KEY && !env.OPENAI_API_KEY) {
    return "gemini";
  }

  return "openai";
}

export function getConfiguredModels(env, provider = getConfiguredProvider(env)) {
  const defaultModel = provider === "gemini"
    ? (env.GEMINI_MODEL || "gemini-2.5-flash").trim()
    : (env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const configured = normalizeModelList((env.ALLOWED_MODELS || defaultModel).split(","));
  return configured.length > 0 ? configured : [defaultModel];
}

export function isModelSwitchEnabled(env) {
  return String(env.ENABLE_MODEL_SWITCH || "false").toLowerCase() === "true";
}

export function resolveModel(env, requestedModel, provider = getConfiguredProvider(env)) {
  const models = getConfiguredModels(env, provider);
  const switchEnabled = isModelSwitchEnabled(env);

  if (!switchEnabled) {
    return models[0];
  }

  if (requestedModel && models.includes(requestedModel)) {
    return requestedModel;
  }

  return models[0];
}

export function createMockReply(message) {
  return `（モック応答）${message}`;
}

function toOpenAIMessages(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
}

function toGeminiContents(messages) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
}

async function generateOpenAIReply({ env, messages, model }) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: toOpenAIMessages(messages),
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    throw new Error("OpenAI response did not contain a reply");
  }

  return reply;
}

async function generateGeminiReply({ env, messages, model }) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const systemInstruction = messages.find((message) => message.role === "system")?.content;
  const response = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...(systemInstruction
        ? {
            systemInstruction: {
              parts: [{ text: systemInstruction }]
            }
          }
        : {}),
      contents: toGeminiContents(messages),
      generationConfig: {
        temperature: 0.7
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const reply = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();

  if (!reply) {
    throw new Error("Gemini response did not contain a reply");
  }

  return reply;
}

export async function generateReply({ env, messages, model }) {
  if (String(env.USE_MOCK_LLM || "false").toLowerCase() === "true") {
    const latest = messages[messages.length - 1]?.content || "";
    return createMockReply(latest);
  }

  const provider = getConfiguredProvider(env);
  if (provider === "gemini") {
    return generateGeminiReply({ env, messages, model });
  }

  return generateOpenAIReply({ env, messages, model });
}

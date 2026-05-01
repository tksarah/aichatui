const appShell = document.getElementById("appShell");
const messagesEl = document.getElementById("messages");
const composerEl = document.getElementById("composer");
const messageInputEl = document.getElementById("messageInput");
const sendButtonEl = document.getElementById("sendButton");
const statusPillEl = document.getElementById("statusPill");
const replyFormatPillEl = document.getElementById("replyFormatPill");
const newChatButtonEl = document.getElementById("newChatButton");
const themeToggleButtonEl = document.getElementById("themeToggleButton");
const modelSelectEl = document.getElementById("modelSelect");
const outputFormatSelectEl = document.getElementById("outputFormatSelect");

const legacyChatHistoryStorageKey = "aichatui.chatHistory.v1";
const chatHistoryClientIdKey = "aichatui.chatHistoryClientId.v1";
const chatHistoryClientId = getOrCreateChatHistoryClientId();
let chatHistoryTtlMs = 30 * 60 * 1000; // default 30 minutes, may be overridden by server
let sessionHistoryVisibleCount = 10;
const sessionArchiveLimit = 12;

const state = {
  activeSession: null,
  archivedSessions: [],
  isSending: false,
  models: [],
  provider: "openai",
  selectedModel: "",
  outputFormat: "plain",
  theme: localStorage.getItem("theme") || "light"
};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(text) {
  const escaped = escapeHtml(text)
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
    .replace(/^[-*+]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/^(\d+)\.\s+(.+)$/gm, "<li>$2</li>");

  const lines = escaped.split("\n");
  const html = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith("<li>")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(line);
      continue;
    }

    if (inList) {
      html.push("</ul>");
      inList = false;
    }

    if (!line.trim()) {
      html.push("<br />");
      continue;
    }

    html.push(`<p>${line}</p>`);
  }

  if (inList) {
    html.push("</ul>");
  }

  return html.join("")
    .replace(/<p>(<h[1-3]>.*<\/h[1-3]>)<\/p>/g, "$1")
    .replace(/<p>(<pre><code>[\s\S]*?<\/code><\/pre>)<\/p>/g, "$1");
}

function setStatus(text) {
  statusPillEl.textContent = text;
}

function formatOutputLabel(format) {
  return format === "rich" ? "返信形式：リッチ" : "返信形式：プレーン";
}

function updateReplyFormatPill(format) {
  if (!replyFormatPillEl) return;
  replyFormatPillEl.textContent = formatOutputLabel(format);
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function updateSessionHistoryVisibility(config) {
  sessionHistoryVisibleCount = normalizePositiveInteger(config?.historyVisibleCount, sessionHistoryVisibleCount);
}

function getOrCreateChatHistoryClientId() {
  const existingClientId = localStorage.getItem(chatHistoryClientIdKey);
  if (existingClientId) {
    return existingClientId;
  }

  const generatedClientId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  localStorage.setItem(chatHistoryClientIdKey, generatedClientId);
  return generatedClientId;
}

function getChatHistoryEndpoint() {
  return `/api/history?clientId=${encodeURIComponent(chatHistoryClientId)}`;
}

function createSession(messages = []) {
  const now = Date.now();
  return {
    id: `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "新しいチャット",
    createdAt: now,
    updatedAt: now,
    messages
  };
}

function getSessionTitle(session) {
  if (!session || !Array.isArray(session.messages) || session.messages.length === 0) {
    return session?.title || "新しいチャット";
  }

  const firstUserMessage = session.messages.find((message) => message.role === "user" && typeof message.content === "string");
  if (firstUserMessage?.content) {
    return firstUserMessage.content.trim().slice(0, 24) || "新しいチャット";
  }

  return session.title || "新しいチャット";
}

function formatSessionSubtitle(session) {
  return new Date(session.updatedAt || session.createdAt).toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function normalizeSession(session) {
  if (!session || typeof session.id !== "string" || !Array.isArray(session.messages)) {
    return null;
  }

  const messages = session.messages.filter(
    (message) =>
      message &&
      typeof message.role === "string" &&
      typeof message.content === "string" &&
      (message.role === "user" || message.role === "assistant" || message.role === "system")
  );

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
  const threshold = Date.now() - chatHistoryTtlMs;
  return sessions
    .filter((session) => session && typeof session.updatedAt === "number" && session.updatedAt >= threshold)
    .slice(0, sessionArchiveLimit);
}

function setActiveSession(session) {
  state.activeSession = session || createSession();
}

function getActiveMessages() {
  return state.activeSession?.messages || [];
}

function saveChatHistory() {
  if (!state.activeSession) {
    return;
  }

  fetch(getChatHistoryEndpoint(), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      activeSession: state.activeSession,
      archivedSessions: pruneArchivedSessions(state.archivedSessions)
    })
  }).catch((error) => {
    console.error(error);
  });
}

async function loadChatHistory() {
  try {
    localStorage.removeItem(legacyChatHistoryStorageKey);

    const response = await fetch(getChatHistoryEndpoint());
    if (!response.ok) {
      throw new Error("履歴の読み込みに失敗しました");
    }

    const parsedValue = await response.json();
      updateSessionHistoryVisibility(parsedValue);
    const archivedSessions = Array.isArray(parsedValue.archivedSessions)
      ? parsedValue.archivedSessions.map(normalizeSession).filter(Boolean)
      : [];
    const activeSession = normalizeSession(parsedValue.activeSession) || createSession();

    state.archivedSessions = pruneArchivedSessions(archivedSessions);
    setActiveSession(activeSession);
  } catch {
    setActiveSession(createSession());
    state.archivedSessions = [];
  }
}

function updateSessionTitle(session) {
  if (!session) {
    return;
  }

  session.title = getSessionTitle(session);
}

function archiveActiveSession() {
  if (!state.activeSession || state.activeSession.messages.length === 0) {
    setActiveSession(createSession());
    saveChatHistory();
    renderMessages();
    renderSessionHistory();
    return;
  }

  const archivedSession = {
    ...state.activeSession,
    messages: state.activeSession.messages.map((message) => ({ ...message })),
    title: getSessionTitle(state.activeSession),
    updatedAt: Date.now()
  };

  state.archivedSessions = pruneArchivedSessions([archivedSession, ...state.archivedSessions.filter((session) => session.id !== archivedSession.id)]);
  setActiveSession(createSession());
  saveChatHistory();
  renderMessages();
  renderSessionHistory();
}

function openArchivedSession(sessionId) {
  const session = state.archivedSessions.find((item) => item.id === sessionId);
  if (!session) {
    return;
  }

  state.archivedSessions = state.archivedSessions.filter((item) => item.id !== sessionId);
  const currentActiveSession = state.activeSession && state.activeSession.messages.length ? state.activeSession : null;
  if (currentActiveSession) {
    state.archivedSessions = pruneArchivedSessions([
      { ...currentActiveSession, messages: currentActiveSession.messages.map((message) => ({ ...message })), title: getSessionTitle(currentActiveSession), updatedAt: Date.now() },
      ...state.archivedSessions
    ]);
  }

  setActiveSession({
    ...session,
    messages: session.messages.map((message) => ({ ...message }))
  });
  saveChatHistory();
  renderMessages();
  renderSessionHistory();
  setStatus(`履歴を開きました: ${getSessionTitle(session)}`);
}

function getSavedChatHistory() {
  void loadChatHistory();
  return getActiveMessages();
}

function renderSessionHistory() {
  const existingHistory = document.getElementById("sessionHistory");
  if (!existingHistory) {
    return;
  }

  existingHistory.innerHTML = "";

  const allSessions = [state.activeSession, ...state.archivedSessions].filter(Boolean);
  if (allSessions.length === 1 && state.activeSession.messages.length === 0) {
    const emptyItem = document.createElement("p");
    emptyItem.className = "session-history-empty";
    emptyItem.textContent = "まだ履歴はありません。";
    existingHistory.appendChild(emptyItem);
    return;
  }

  for (const session of allSessions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-history-item${session.id === state.activeSession?.id ? " active" : ""}`;
    button.innerHTML = `
      <span class="session-history-title">${escapeHtml(getSessionTitle(session))}</span>
      <span class="session-history-meta">${escapeHtml(formatSessionSubtitle(session))} ・ ${session.messages.length}件</span>
    `;
    button.addEventListener("click", () => {
      if (session.id === state.activeSession?.id) {
        return;
      }

      if (state.activeSession && state.activeSession.messages.length) {
        state.archivedSessions = pruneArchivedSessions([
          { ...state.activeSession, messages: state.activeSession.messages.map((message) => ({ ...message })), title: getSessionTitle(state.activeSession), updatedAt: Date.now() },
          ...state.archivedSessions.filter((item) => item.id !== session.id)
        ]);
      }

      state.archivedSessions = state.archivedSessions.filter((item) => item.id !== session.id);
      setActiveSession({
        ...session,
        messages: session.messages.map((message) => ({ ...message }))
      });
      saveChatHistory();
      renderMessages();
      renderSessionHistory();
      setStatus(`セッションを切り替えました: ${getSessionTitle(session)}`);
    });
    existingHistory.appendChild(button);
  }

  // 履歴コンテナ高さを調整（10件まではスクロールさせない）
  updateSessionHistoryMaxHeight();
}

// 履歴リストの高さを動的に決める
function updateSessionHistoryMaxHeight() {
  const container = document.getElementById("sessionHistory");
  if (!container) return;

  const emptyItem = container.querySelector('.session-history-empty');
  const items = Array.from(container.querySelectorAll('.session-history-item'));

  if (!items.length || emptyItem) {
    container.style.maxHeight = null;
    container.style.overflowY = null;
    return;
  }

  const count = items.length;
  const visibleCount = normalizePositiveInteger(sessionHistoryVisibleCount, 10);

  if (count <= visibleCount) {
    container.style.maxHeight = null;
    container.style.overflowY = 'visible';
    return;
  }

  const first = items[0];
  const itemHeight = first.offsetHeight;
  const computed = getComputedStyle(container);
  const gap = parseFloat(computed.rowGap || computed.gap) || 0;
  const total = itemHeight * visibleCount + gap * (visibleCount - 1);
  container.style.maxHeight = `${Math.ceil(total)}px`;
  container.style.overflowY = 'auto';
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  localStorage.setItem("theme", theme);
  themeToggleButtonEl.textContent = theme === "dark" ? "ライトモード切り替え" : "ダークモード切り替え";
}

function getAssistantMessageElement(text, role = "assistant", outputFormat = "plain") {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}`;
  if (role === "assistant" && outputFormat === "rich") {
    messageEl.innerHTML = renderMarkdown(text);
  } else {
    messageEl.textContent = text;
  }
  return messageEl;
}

function renderMessages() {
  messagesEl.innerHTML = "";

  if (getActiveMessages().length === 0) {
    messagesEl.appendChild(getAssistantMessageElement("ここにメッセージが表示されます。", "system"));
    scrollToBottom();
    return;
  }

  for (const message of getActiveMessages()) {
    messagesEl.appendChild(getAssistantMessageElement(message.content, message.role, message.outputFormat));
  }

  scrollToBottom();
}

function setSending(isSending) {
  state.isSending = isSending;
  sendButtonEl.disabled = isSending;
  messageInputEl.disabled = isSending;
  if (isSending) {
    setStatus("応答を生成中...");
  } else {
    setStatus("準備完了");
  }
}

function showLoadingBubble() {
  const loadingEl = document.createElement("div");
  loadingEl.className = "message assistant loading";
  loadingEl.id = "loadingBubble";
  loadingEl.innerHTML = `
    <span>考えています</span>
    <span class="loading-dots" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </span>
  `;
  messagesEl.appendChild(loadingEl);
  scrollToBottom();
}

function hideLoadingBubble() {
  const loadingBubble = document.getElementById("loadingBubble");
  if (loadingBubble) {
    loadingBubble.remove();
  }
}

function autoGrowTextarea() {
  messageInputEl.style.height = "auto";
  messageInputEl.style.height = `${Math.min(messageInputEl.scrollHeight, 220)}px`;
}

function resetChat() {
  archiveActiveSession();
  renderMessages();
  messageInputEl.value = "";
  autoGrowTextarea();
  setStatus("新しいセッションを開始しました");
}

function saveThemeFromMediaQuery() {
  if (!localStorage.getItem("theme")) {
    applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    return;
  }

  applyTheme(state.theme);
}

function updateModelOptions(config) {
  state.models = Array.isArray(config.models) ? config.models : [];
  state.provider = config.provider || "openai";
  state.selectedModel = config.selectedModel || state.models[0] || "";

  modelSelectEl.innerHTML = "";
  for (const model of state.models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelectEl.appendChild(option);
  }

  if (state.selectedModel) {
    modelSelectEl.value = state.selectedModel;
  }

  modelSelectEl.disabled = !config.modelSwitchEnabled || state.models.length <= 1;
  modelSelectEl.closest(".sidebar-section").style.display = state.models.length ? "grid" : "none";
}

function updateOutputFormat(format) {
  state.outputFormat = format === "rich" ? "rich" : "plain";
  outputFormatSelectEl.value = state.outputFormat;
  renderMessages();
  updateReplyFormatPill(state.outputFormat);
}

async function loadModelConfig() {
  const response = await fetch("/api/models");
  if (!response.ok) {
    throw new Error("モデル設定の読み込みに失敗しました");
  }

  const data = await response.json();
  updateSessionHistoryVisibility(data);
  updateModelOptions(data);
  return data;
}

async function sendMessage(messageText) {
  if (!messageText.trim() || state.isSending) {
    return;
  }

  const userMessage = { role: "user", content: messageText.trim() };
  state.activeSession.messages.push(userMessage);
  updateSessionTitle(state.activeSession);
  saveChatHistory();
  renderMessages();
  showLoadingBubble();
  setSending(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: messageText.trim(),
        history: state.activeSession.messages.slice(0, -1),
        model: state.selectedModel || undefined,
        outputFormat: state.outputFormat
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "API request failed");
    }

    const data = await response.json();
  state.activeSession.messages.push({ role: "assistant", content: data.reply, outputFormat: data.outputFormat || state.outputFormat });
  updateSessionTitle(state.activeSession);
    saveChatHistory();
    hideLoadingBubble();
    renderMessages();
    setStatus(data.provider && data.model ? `応答完了 / ${data.provider} / ${data.model} / ${data.outputFormat || state.outputFormat}` : "応答完了");
  } catch (error) {
    hideLoadingBubble();
    state.activeSession.messages.push({ role: "assistant", content: `エラーが発生しました: ${error.message}` });
    updateSessionTitle(state.activeSession);
    saveChatHistory();
    renderMessages();
    setStatus("エラーが発生しました");
  } finally {
    setSending(false);
    messageInputEl.focus();
  }
}

composerEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage(messageInputEl.value);
  messageInputEl.value = "";
  autoGrowTextarea();
});

messageInputEl.addEventListener("input", autoGrowTextarea);
messageInputEl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await composerEl.requestSubmit();
  }
});

newChatButtonEl.addEventListener("click", resetChat);
themeToggleButtonEl.addEventListener("click", () => {
  applyTheme(state.theme === "dark" ? "light" : "dark");
});
modelSelectEl.addEventListener("change", (event) => {
  state.selectedModel = event.target.value;
  setStatus(`モデル選択: ${state.selectedModel}`);
});
outputFormatSelectEl.addEventListener("change", (event) => {
  updateOutputFormat(event.target.value);
  updateReplyFormatPill(state.outputFormat);
});

window.addEventListener("resize", () => {
  scrollToBottom();
  updateSessionHistoryMaxHeight();
});

saveThemeFromMediaQuery();
updateOutputFormat(state.outputFormat);
setStatus("初期化中...");
loadModelConfig()
  .then(async (data) => {
    if (data && typeof data.historyTtlMinutes === "number") {
      chatHistoryTtlMs = Number(data.historyTtlMinutes) * 60 * 1000;
    }
    await loadChatHistory();
    renderMessages();
    renderSessionHistory();
    setStatus("準備完了");
  })
  .catch(async (error) => {
    console.error(error);
    // fallback: still try to load any server-side history with default TTL
    await loadChatHistory();
    renderMessages();
    renderSessionHistory();
    setStatus("モデル設定の読み込みに失敗しました");
  });

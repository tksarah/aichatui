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

const state = {
  messages: [],
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

  if (state.messages.length === 0) {
    messagesEl.appendChild(getAssistantMessageElement("ここにメッセージが表示されます。", "system"));
    scrollToBottom();
    return;
  }

  for (const message of state.messages) {
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
  state.messages = [];
  renderMessages();
  messageInputEl.value = "";
  autoGrowTextarea();
  setStatus("新規チャットを開始しました");
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
  updateModelOptions(data);
}

async function sendMessage(messageText) {
  if (!messageText.trim() || state.isSending) {
    return;
  }

  const userMessage = { role: "user", content: messageText.trim() };
  state.messages.push(userMessage);
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
        history: state.messages.slice(0, -1),
        model: state.selectedModel || undefined,
        outputFormat: state.outputFormat
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "API request failed");
    }

    const data = await response.json();
    state.messages.push({ role: "assistant", content: data.reply, outputFormat: data.outputFormat || state.outputFormat });
    hideLoadingBubble();
    renderMessages();
    setStatus(data.provider && data.model ? `応答完了 / ${data.provider} / ${data.model} / ${data.outputFormat || state.outputFormat}` : "応答完了");
  } catch (error) {
    hideLoadingBubble();
    state.messages.push({ role: "assistant", content: `エラーが発生しました: ${error.message}` });
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

window.addEventListener("resize", scrollToBottom);

saveThemeFromMediaQuery();
updateOutputFormat(state.outputFormat);
renderMessages();
setStatus("初期化中...");
loadModelConfig()
  .then(() => setStatus("準備完了"))
  .catch((error) => {
    console.error(error);
    setStatus("モデル設定の読み込みに失敗しました");
  });

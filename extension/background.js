/* global chrome */
const BRIDGE_URL = "ws://127.0.0.1:3002";
const CHATGPT_URL = "https://chatgpt.com/";
const RECONNECT_DELAY_MS = 1_500;

let socket = null;
let reconnectTimer = null;
let activeRequestId = null;

function emit(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
}

async function findChatGptTab() {
  const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  return tabs.find((tab) => tab.active) || tabs[0] || null;
}

async function waitForTab(tabId) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return current;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("CHATGPT_NAVIGATION_TIMEOUT"));
    }, 60_000);
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendToContent(tabId, message, attempts = 60) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("CHATGPT_CONTENT_SCRIPT_UNAVAILABLE");
}

async function ensureChatGptTab(targetUrl = CHATGPT_URL) {
  let tab = await findChatGptTab();
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: targetUrl, active: true });
    await waitForTab(tab.id);
    return tab;
  }

  const currentUrl = tab.url || "";
  if (currentUrl !== targetUrl) {
    tab = await chrome.tabs.update(tab.id, { url: targetUrl, active: true });
    await waitForTab(tab.id);
  } else {
    await chrome.tabs.update(tab.id, { active: true });
  }
  return tab;
}

async function collectStatus() {
  const tab = await findChatGptTab();
  if (!tab?.id) {
    return {
      type: "status",
      ready: false,
      url: null,
      title: "",
      modelLabel: "",
    };
  }

  try {
    const status = await sendToContent(tab.id, { action: "status" }, 4);
    return {
      type: "status",
      ready: Boolean(status?.ready),
      url: tab.url || status?.url || null,
      title: tab.title || status?.title || "",
      modelLabel: status?.modelLabel || "",
    };
  } catch {
    return {
      type: "status",
      ready: false,
      url: tab.url || null,
      title: tab.title || "",
      modelLabel: "",
    };
  }
}

async function handleGenerate(command) {
  if (activeRequestId && activeRequestId !== command.requestId) {
    emit({
      type: "generation",
      requestId: command.requestId,
      event: "error",
      code: "CHATGPT_GENERATION_BUSY",
    });
    return;
  }

  activeRequestId = command.requestId;
  try {
    const targetUrl = typeof command.threadUrl === "string" && command.threadUrl
      ? command.threadUrl
      : CHATGPT_URL;
    const tab = await ensureChatGptTab(targetUrl);
    await sendToContent(tab.id, {
      action: "generate",
      requestId: command.requestId,
      prompt: command.prompt,
      modelId: command.modelId,
      timeoutMs: command.timeoutMs,
    });
  } catch (error) {
    activeRequestId = null;
    emit({
      type: "generation",
      requestId: command.requestId,
      event: "error",
      code: error instanceof Error ? error.message : "CHATGPT_EXTENSION_ERROR",
    });
  }
}

async function handleCancel(command) {
  const tab = await findChatGptTab();
  if (tab?.id) {
    await sendToContent(tab.id, {
      action: "cancel",
      requestId: command.requestId,
    }, 4).catch(() => undefined);
  }
}

async function handleCommand(command) {
  if (command.action === "status") {
    emit(await collectStatus());
    return;
  }
  if (command.action === "generate") {
    await handleGenerate(command);
    return;
  }
  if (command.action === "cancel") {
    await handleCancel(command);
  }
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  socket = new WebSocket(BRIDGE_URL);
  socket.addEventListener("open", async () => {
    emit({
      ...(await collectStatus()),
      type: "hello",
      extensionVersion: chrome.runtime.getManifest().version,
    });
  });
  socket.addEventListener("message", (event) => {
    let command;
    try {
      command = JSON.parse(event.data);
    } catch {
      return;
    }
    if (command?.type === "command") void handleCommand(command);
  });
  socket.addEventListener("close", scheduleReconnect);
  socket.addEventListener("error", () => socket?.close());
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "bridge-status") {
    emit({ type: "status", ...message.status });
    return;
  }
  if (message?.type !== "bridge-generation") return;

  emit({
    type: "generation",
    requestId: message.requestId,
    event: message.event,
    ...(typeof message.content === "string" ? { content: message.content } : {}),
    ...(typeof message.url === "string" ? { url: message.url } : {}),
    ...(typeof message.code === "string" ? { code: message.code } : {}),
  });

  if (["done", "cancelled", "error"].includes(message.event)) {
    activeRequestId = null;
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab.url?.startsWith(CHATGPT_URL)) return;
  if (changeInfo.status === "complete" || changeInfo.url) {
    void collectStatus().then(emit);
  }
});

setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) {
    emit({ type: "ping", at: Date.now() });
  }
}, 20_000);

connect();

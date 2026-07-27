/* global process */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { browserJsonFetch, browserStreamFetch } from "./browser-stream.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.QWEN_STATE_DIR ? path.resolve(process.env.QWEN_STATE_DIR) : __dirname;
fs.mkdirSync(STATE_DIR, { recursive: true });
const AUTH_FILE = path.join(STATE_DIR, "auth.json");
const TARGET_URL = "https://chat.qwen.ai/";
const GENERATION_TIMEOUT_MS = Math.max(30_000, Number(process.env.QWEN_GENERATION_TIMEOUT_MS || 270_000));
const QWEN_WEB_VERSION = process.env.QWEN_WEB_VERSION || "0.2.66";

const SELECTORS = {
  input: "textarea",
  send: "button.send-button, button[aria-label*='Send'], button[aria-label*='send']",
  stop: "button.stop-button, button[aria-label*='Stop'], button[aria-label*='stop']",
};

function isQwenThreadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "chat.qwen.ai";
  } catch {
    return false;
  }
}

class QwenBridge {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isReady = false;
  }

  async init() {
    const headless = process.env.QWEN_HEADLESS !== "false";
    this.browser = await chromium.launch({ headless, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    this.context = await this.browser.newContext({
      ...(fs.existsSync(AUTH_FILE) ? { storageState: AUTH_FILE } : {}),
      viewport: { width: 1280, height: 800 },
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30_000);
    this.page.setDefaultNavigationTimeout(60_000);
    await this.page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    await this.handleLogin();
    // A conta pode pedir CAPTCHA, código de e-mail ou outro desafio. O servidor
    // continua disponível para a tela protegida /setup nesses casos, em vez de
    // reiniciar indefinidamente e perder a chance de concluir o login manual.
    await this.refreshReadiness(2_000);
  }

  async handleLogin() {
    try {
      const loggedOut = this.page.getByText("Stay logged out", { exact: true });
      if (await loggedOut.isVisible({ timeout: 3_000 })) await loggedOut.click();
    } catch { /* O botão não existe em sessões autenticadas. */ }

    const email = process.env.QWEN_EMAIL;
    const password = process.env.QWEN_PASSWORD;
    if (!email || !password) return;
    try {
      const login = this.page.locator("button:has-text('Log in'), .login-button").first();
      if (!(await login.isVisible({ timeout: 3_000 }))) return;
      await login.click();
      const emailField = this.page.locator("input[type='email'], input[name='email']").first();
      await emailField.waitFor({ state: "visible", timeout: 20_000 });
      await emailField.fill(email);
      await emailField.press("Enter");
      const passwordField = this.page.locator("input[type='password']").first();
      await passwordField.waitFor({ state: "visible", timeout: 20_000 });
      await passwordField.fill(password);
      await passwordField.press("Enter");
      await this.page.waitForSelector(SELECTORS.input, { state: "visible", timeout: 60_000 });
    } catch (error) {
      console.warn("Automatic Qwen login was not completed:", error instanceof Error ? error.message : error);
    }
  }

  async persistSession() {
    await this.context.storageState({ path: AUTH_FILE });
  }

  async refreshReadiness(timeout = 1_000) {
    if (!this.page) {
      this.isReady = false;
      return false;
    }
    this.isReady = await this.page.locator(SELECTORS.input).first()
      .isVisible({ timeout })
      .catch(() => false);
    if (this.isReady) await this.persistSession();
    return this.isReady;
  }

  async setupStatus() {
    const ready = await this.refreshReadiness();
    return {
      ready,
      url: this.page?.url() || null,
      title: this.page ? await this.page.title().catch(() => "") : "",
    };
  }

  async setupScreenshot() {
    if (!this.page) throw new Error("BRIDGE_NOT_READY");
    return this.page.screenshot({ type: "png" });
  }

  async setupClick(x, y) {
    if (!this.page) throw new Error("BRIDGE_NOT_READY");
    await this.page.mouse.click(x, y);
    return this.setupStatus();
  }

  async setupType(text) {
    if (!this.page) throw new Error("BRIDGE_NOT_READY");
    await this.page.keyboard.type(text);
    return this.setupStatus();
  }

  async setupPress(key) {
    if (!this.page) throw new Error("BRIDGE_NOT_READY");
    await this.page.keyboard.press(key);
    return this.setupStatus();
  }

  async openThread(threadUrl) {
    if (!threadUrl) return this.startNewChat();
    if (!isQwenThreadUrl(threadUrl)) throw new Error("INVALID_THREAD_URL");
    if (this.page.url() !== threadUrl) await this.page.goto(threadUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await this.page.waitForSelector(SELECTORS.input, { state: "visible", timeout: 30_000 });
  }

  async startNewChat() {
    if (!this.page.url().startsWith(TARGET_URL)) await this.page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    const candidates = [
      "button:has-text('New Chat')",
      "button:has-text('New chat')",
      "a:has-text('New Chat')",
      "[aria-label*='New chat']",
      "[aria-label*='New Chat']",
    ];
    let opened = false;
    for (const selector of candidates) {
      try {
        const button = this.page.locator(selector).first();
        if (await button.isVisible({ timeout: 800 })) {
          await button.click();
          opened = true;
          break;
        }
      } catch { /* Tenta o próximo seletor. */ }
    }
    if (!opened && this.page.url() !== TARGET_URL) await this.page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    await this.page.waitForSelector(SELECTORS.input, { state: "visible", timeout: 30_000 });
  }

  async switchModel(modelName) {
    if (!modelName) return;
    try {
      const current = this.page.locator("header, [class*='header']").filter({ hasText: modelName }).first();
      if (await current.isVisible({ timeout: 800 })) return;
    } catch { /* Continua para abrir o seletor. */ }
    const trigger = this.page.locator("[class*='header-left'], button").filter({ hasText: /Qwen/i }).first();
    try {
      await trigger.click({ timeout: 5_000 });
      const option = this.page.locator("[role='menuitem'], li, [class*='item']").filter({ hasText: modelName }).last();
      await option.click({ timeout: 5_000 });
    } catch (error) {
      console.warn(`Could not select ${modelName}; keeping the current Qwen model.`, error instanceof Error ? error.message : error);
    }
  }

  async createChat(modelId) {
    if (!this.isReady && !(await this.refreshReadiness())) throw new Error("BRIDGE_NOT_READY");
    const result = await browserJsonFetch(this.page, "https://chat.qwen.ai/api/v2/chats/new", {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-Request-Id": crypto.randomUUID(),
        Timezone: new Date().toString().split(" (")[0],
        Version: QWEN_WEB_VERSION,
        Source: "web",
      },
      body: JSON.stringify({
        title: "SKMake",
        models: [modelId],
        chat_mode: "normal",
        chat_type: "t2t",
        timestamp: Date.now(),
        project_id: "",
      }),
      timeoutMs: 30_000,
    });
    if (result.status >= 400) throw new Error(`QWEN_CREATE_CHAT_${result.status}`);
    let payload;
    try { payload = JSON.parse(result.body); } catch { throw new Error("QWEN_CREATE_CHAT_INVALID_RESPONSE"); }
    const chatId = payload.chat_id || payload.id || payload.data?.chat_id || payload.data?.id;
    if (!chatId) throw new Error("QWEN_CREATE_CHAT_INVALID_RESPONSE");
    return chatId;
  }

  async createCompatibleChat(modelId, fallbackModelIds = []) {
    let lastError;
    for (const candidate of [modelId, ...fallbackModelIds]) {
      try {
        return { chatId: await this.createChat(candidate), modelId: candidate };
      } catch (error) {
        lastError = error;
        const code = error instanceof Error ? error.message : "";
        if (!code.startsWith("QWEN_CREATE_CHAT_4")) throw error;
        console.warn(`Qwen model ${candidate} is unavailable; trying the next compatible model.`);
      }
    }
    throw lastError || new Error("QWEN_MODEL_UNAVAILABLE");
  }

  async createCompletionStream(message, { chatId = null, parentId = null, modelId = "qwen3.7-plus", fallbackModelIds = [], reasoningEffort = "adaptive" } = {}) {
    if (!this.isReady && !(await this.refreshReadiness())) throw new Error("BRIDGE_NOT_READY");
    const created = chatId ? { chatId, modelId } : await this.createCompatibleChat(modelId, fallbackModelIds);
    const resolvedChatId = created.chatId;
    const resolvedModelId = created.modelId;
    const resolvedFallbackIndex = fallbackModelIds.indexOf(resolvedModelId);
    const remainingFallbacks = resolvedModelId === modelId ? fallbackModelIds : fallbackModelIds.slice(resolvedFallbackIndex + 1);
    const timestamp = Math.floor(Date.now() / 1000);
    const requiresThinking = resolvedModelId === "qwen3.8-max-preview";
    const thinkingEnabled = requiresThinking || reasoningEffort !== "none";
    const automaticThinking = reasoningEffort === "adaptive" || (requiresThinking && reasoningEffort === "none");
    const payload = {
      stream: true,
      version: "2.1",
      incremental_output: true,
      chat_id: resolvedChatId,
      chat_mode: "normal",
      model: resolvedModelId,
      parent_id: parentId,
      messages: [{
        fid: crypto.randomUUID(),
        parentId,
        childrenIds: [],
        role: "user",
        content: message,
        user_action: "chat",
        files: [],
        timestamp,
        models: [resolvedModelId],
        chat_type: "t2t",
        feature_config: {
          thinking_enabled: thinkingEnabled,
          output_schema: "phase",
          research_mode: "normal",
          auto_thinking: automaticThinking,
          thinking_mode: automaticThinking ? "Auto" : thinkingEnabled ? "Thinking" : "Auto",
          thinking_format: "summary",
          auto_search: false,
        },
        extra: { meta: { subChatType: "t2t" } },
        sub_chat_type: "t2t",
        parent_id: parentId,
      }],
      timestamp: timestamp + 1,
    };
    let result;
    try {
      result = await browserStreamFetch(
        this.page,
        `https://chat.qwen.ai/api/v2/chat/completions?chat_id=${encodeURIComponent(resolvedChatId)}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Accel-Buffering": "no",
            "X-Request-Id": crypto.randomUUID(),
            Timezone: new Date().toString().split(" (")[0],
            Version: QWEN_WEB_VERSION,
            Source: "web",
          },
          body: JSON.stringify(payload),
          timeoutMs: GENERATION_TIMEOUT_MS,
        },
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (!chatId && code.startsWith("QWEN_UPSTREAM_") && remainingFallbacks.length) {
        console.warn(`Qwen model ${resolvedModelId} rejected the completion; trying ${remainingFallbacks[0]}.`);
        return this.createCompletionStream(message, {
          chatId: null,
          parentId: null,
          modelId: remainingFallbacks[0],
          fallbackModelIds: remainingFallbacks.slice(1),
          reasoningEffort,
        });
      }
      throw error;
    }
    return {
      ...result,
      chatId: resolvedChatId,
      modelId: resolvedModelId,
      threadUrl: `https://chat.qwen.ai/c/${resolvedChatId}`,
    };
  }

  async ask(message, { threadUrl = null, modelName = null } = {}) {
    if (!this.isReady && !(await this.refreshReadiness())) throw new Error("BRIDGE_NOT_READY");
    await this.openThread(threadUrl);
    if (!threadUrl) await this.switchModel(modelName);
    const textarea = this.page.locator(SELECTORS.input).first();
    await textarea.fill(message);
    const responseCountBefore = await this.responseBlocks().count();
    const upstreamResponse = this.page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/api/v2/chat/completions"),
      { timeout: 30_000 },
    ).catch(() => null);
    const send = this.page.locator(SELECTORS.send).first();
    if (await send.isVisible({ timeout: 2_000 }).catch(() => false)) await send.click();
    else await textarea.press("Enter");

    const stop = this.page.locator(SELECTORS.stop).first();
    const stopSeen = await stop.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
    if (stopSeen) {
      try {
        await stop.waitFor({ state: "hidden", timeout: GENERATION_TIMEOUT_MS });
      } catch {
        throw new Error("QWEN_TIMEOUT");
      }
    } else {
      await this.waitForStableResponse(responseCountBefore);
    }
    await this.page.waitForFunction((count) => {
      const blocks = document.querySelectorAll(".markdown, .prose, [class*='message-content']");
      return blocks.length > count;
    }, responseCountBefore, { timeout: 10_000 }).catch(() => undefined);
    await this.page.waitForTimeout(500);
    const captured = await upstreamResponse;
    const text = captured
      ? await captured.text().then(parseQwenStreamText).catch(() => "")
      : "";
    const finalText = text || await this.extractLastResponse();
    const currentUrl = this.page.url();
    await this.persistSession();
    if (!finalText) throw new Error("EMPTY_QWEN_RESPONSE");
    return { text: finalText, threadUrl: isQwenThreadUrl(currentUrl) ? currentUrl : null };
  }

  responseBlocks() {
    return this.page.locator(".markdown, .prose, [class*='message-content']");
  }

  async waitForStableResponse(responseCountBefore) {
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    let previous = "";
    let stableChecks = 0;
    while (Date.now() < deadline) {
      const blocks = this.responseBlocks();
      const count = await blocks.count();
      const current = count > responseCountBefore ? (await blocks.last().innerText().catch(() => "")).trim() : "";
      if (current && current === previous) stableChecks += 1;
      else stableChecks = 0;
      if (stableChecks >= 4) return;
      previous = current;
      await this.page.waitForTimeout(500);
    }
    throw new Error("QWEN_TIMEOUT");
  }

  async extractLastResponse() {
    return this.page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll(".markdown, .prose, [class*='message-content']"));
      const block = blocks.at(-1);
      if (!block) return "";
      const clone = block.cloneNode(true);
      clone.querySelectorAll("button, svg, .action-buttons").forEach((element) => element.remove());
      clone.querySelectorAll("pre").forEach((pre) => {
        const viewLines = Array.from(pre.querySelectorAll(".view-line"))
          .map((line) => line.textContent || "");
        const codeNode = pre.querySelector("code");
        const code = (viewLines.length ? viewLines.join("\n") : codeNode?.textContent || pre.textContent || "").trimEnd();
        const language = codeNode?.className.match(/language-([\w-]+)/)?.[1] || "";
        pre.replaceWith(document.createTextNode(`\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`));
      });
      clone.querySelectorAll("br").forEach((element) => element.replaceWith(document.createTextNode("\n")));
      clone.querySelectorAll("p, h1, h2, h3, h4, li, blockquote").forEach((element) => element.append(document.createTextNode("\n")));
      return (clone.textContent || "")
        .replace(/Copy\s*Code/gi, "")
        .replace(/Thinking\s*(completed|\.\.\.)/gi, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    });
  }

  async stop() {
    if (!this.page) return false;
    const stop = this.page.locator(SELECTORS.stop).first();
    if (!(await stop.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
    await stop.click();
    return true;
  }

  async close() {
    this.isReady = false;
    if (this.context) await this.persistSession().catch(() => undefined);
    if (this.browser) await this.browser.close();
  }
}

export function mergeStreamContent(previous, incoming) {
  if (!incoming || incoming === "FINISHED" || incoming === previous) return previous;
  if (!previous || incoming.startsWith(previous)) return incoming;
  if (previous.endsWith(incoming)) return previous;
  return previous + incoming;
}

export function parseQwenStreamText(raw) {
  let responseId = null;
  let content = "";
  for (const line of raw.split(/\r?\n/)) {
    const value = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!value || value === "[DONE]") continue;
    let chunk;
    try {
      chunk = JSON.parse(value);
    } catch {
      continue;
    }
    const createdId = chunk["response.created"]?.response_id;
    if (createdId && !responseId) responseId = createdId;
    if (responseId && chunk.response_id && chunk.response_id !== responseId) continue;
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.phase !== "answer" || typeof delta.content !== "string") continue;
    content = mergeStreamContent(content, delta.content);
  }
  return content.trim();
}

export default new QwenBridge();

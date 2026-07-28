/* global process */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.CHATGPT_STATE_DIR
  ? path.resolve(process.env.CHATGPT_STATE_DIR)
  : path.join(__dirname, "state");
const PROFILE_DIR = path.join(STATE_DIR, "chrome-profile");
const TARGET_URL = "https://chatgpt.com/";
const VIEWPORT = { width: 1440, height: 900 };
const GENERATION_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.CHATGPT_GENERATION_TIMEOUT_MS || 480_000),
);
const POLL_INTERVAL_MS = Math.max(
  80,
  Number(process.env.CHATGPT_POLL_INTERVAL_MS || 160),
);

fs.mkdirSync(PROFILE_DIR, { recursive: true });

const SELECTORS = {
  input: 'textarea[name="prompt-textarea"]',
  send: '[data-testid="send-button"], button[aria-label="Enviar prompt"], button[aria-label="Send prompt"]',
  stop: '[data-testid="stop-button"], button[aria-label*="Parar"], button[aria-label*="Stop"]',
  newChat: '[data-testid="create-new-chat-button"]',
  assistant: 'main [data-message-author-role="assistant"]',
};

const MODEL_LEVELS = {
  "gpt-5.5": {
    id: "gpt-5.5",
    labels: ["Instantâneo", "Instant"],
  },
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    labels: ["Médio", "Medium"],
  },
  "gpt-5.6-sol-thinking": {
    id: "gpt-5.6-sol-thinking",
    labels: ["Alto", "High"],
  },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactLabels(labels) {
  return new RegExp(`^(?:${labels.map(escapeRegExp).join("|")})$`, "i");
}

function isChatGptThreadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "chatgpt.com"
      && /^\/c\/[a-z0-9-]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function incrementalDelta(previous, incoming) {
  if (!incoming || incoming === previous) return "";
  if (!previous) return incoming;
  if (incoming.startsWith(previous)) return incoming.slice(previous.length);
  if (previous.startsWith(incoming) || previous.endsWith(incoming)) return "";

  return "";
}

export class ChatGptBridge {
  constructor() {
    this.context = null;
    this.page = null;
    this.isReady = false;
    this.activeCancellation = null;
  }

  configurePage(page) {
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(60_000);
    this.page = page;
  }

  adoptLatestPage() {
    if (!this.context) return this.page;
    const pages = this.context.pages().filter((page) => !page.isClosed());
    if (!pages.length) return this.page;
    if (!this.page || this.page.isClosed() || !this.isReady) {
      this.configurePage(pages.at(-1));
    }
    return this.page;
  }

  async init() {
    const headless = process.env.CHATGPT_HEADLESS === "true";
    const channel = process.env.CHATGPT_BROWSER_CHANNEL || "chrome";

    try {
      this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel,
        headless,
        viewport: VIEWPORT,
        locale: process.env.CHATGPT_LOCALE || "pt-BR",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/channel|chrome|executable/i.test(message)) {
        throw new Error("CHROME_NOT_INSTALLED", { cause: error });
      }
      throw error;
    }

    this.context.on("page", (page) => {
      if (!this.isReady) this.configurePage(page);
    });
    this.configurePage(this.context.pages()[0] || await this.context.newPage());

    if (!this.page.url().startsWith("https://chatgpt.com")) {
      await this.page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    }

    await this.refreshReadiness(3_000);
  }

  async refreshReadiness(timeout = 1_000) {
    this.adoptLatestPage();
    if (!this.page) {
      this.isReady = false;
      return false;
    }

    this.isReady = await this.page
      .locator(SELECTORS.input)
      .first()
      .isVisible({ timeout })
      .catch(() => false);
    return this.isReady;
  }

  async setupStatus() {
    const ready = await this.refreshReadiness();
    return {
      ready,
      url: this.page?.url() || null,
      title: this.page ? await this.page.title().catch(() => "") : "",
      browser: process.env.CHATGPT_BROWSER_CHANNEL || "chrome",
      headless: process.env.CHATGPT_HEADLESS === "true",
    };
  }

  async setupScreenshot() {
    this.adoptLatestPage();
    if (!this.page) throw new Error("BRIDGE_NOT_READY");
    return this.page.screenshot({ type: "png" });
  }

  async setupClick(x, y) {
    this.adoptLatestPage();
    if (!this.page) throw new Error("BRIDGE_NOT_READY");
    await this.page.mouse.click(x, y);
    return this.setupStatus();
  }

  async setupType(text) {
    this.adoptLatestPage();
    if (!this.page) throw new Error("BRIDGE_NOT_READY");
    await this.page.keyboard.type(text, { delay: 20 });
    return this.setupStatus();
  }

  async setupPress(key) {
    this.adoptLatestPage();
    if (!this.page) throw new Error("BRIDGE_NOT_READY");
    await this.page.keyboard.press(key);
    return this.setupStatus();
  }

  async ensureReady() {
    if (!this.isReady && !(await this.refreshReadiness())) {
      throw new Error("CHATGPT_LOGIN_REQUIRED");
    }
  }

  async openThread(threadUrl) {
    await this.ensureReady();
    if (!threadUrl) return this.startNewChat();
    if (!isChatGptThreadUrl(threadUrl)) throw new Error("INVALID_THREAD_URL");

    if (this.page.url() !== threadUrl) {
      await this.page.goto(threadUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
    await this.page.locator(SELECTORS.input).first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }

  async startNewChat() {
    await this.ensureReady();
    const currentUrl = this.page.url();
    const button = this.page.locator(SELECTORS.newChat).first();
    const clicked = await button
      .isVisible({ timeout: 1_500 })
      .then(async (visible) => {
        if (!visible) return false;
        await button.click();
        return true;
      })
      .catch(() => false);

    if (!clicked || isChatGptThreadUrl(currentUrl)) {
      await this.page.goto(TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }

    await this.page.locator(SELECTORS.input).first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }

  modelTrigger() {
    const allLabels = Object.values(MODEL_LEVELS).flatMap((model) => model.labels);
    return this.page
      .locator("main button")
      .filter({ hasText: exactLabels(allLabels) })
      .last();
  }

  async switchModel(modelId) {
    const model = MODEL_LEVELS[modelId];
    if (!model) throw new Error("MODEL_UNAVAILABLE");

    const trigger = this.modelTrigger();
    if (!(await trigger.isVisible({ timeout: 3_000 }).catch(() => false))) {
      throw new Error("MODEL_SELECTOR_NOT_FOUND");
    }

    const currentLabel = (await trigger.innerText()).trim();
    if (model.labels.some((label) => label.toLocaleLowerCase() === currentLabel.toLocaleLowerCase())) {
      return model.id;
    }

    await trigger.click();
    const targetPattern = exactLabels(model.labels);
    const candidates = this.page.getByText(targetPattern, { exact: true });

    let selected = false;
    for (let index = (await candidates.count()) - 1; index >= 0; index -= 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click();
        selected = true;
        break;
      }
    }

    if (!selected) {
      await this.page.keyboard.press("Escape").catch(() => undefined);
      throw new Error("MODEL_UNAVAILABLE");
    }

    await this.page.waitForTimeout(250);
    const selectedLabel = (await this.modelTrigger().innerText().catch(() => "")).trim();
    if (!model.labels.some((label) => label.toLocaleLowerCase() === selectedLabel.toLocaleLowerCase())) {
      throw new Error("MODEL_SELECTION_FAILED");
    }
    return model.id;
  }

  assistantBlocks() {
    return this.page.locator(SELECTORS.assistant);
  }

  async extractLastAssistantMarkdown(minimumCount = 0) {
    const blocks = this.assistantBlocks();
    const count = await blocks.count();
    if (count <= minimumCount) return "";

    return blocks.last().evaluate((root) => {
      const normalize = (value) => value
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const walk = (node, depth = 0) => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
        if (!(node instanceof HTMLElement)) return "";
        if (
          node.matches("button, svg, [role='button'], [data-testid*='copy'], [aria-hidden='true']")
          || node.closest("[data-message-author-role='assistant']") !== root
        ) return "";

        const tag = node.tagName.toLowerCase();
        const children = () => Array.from(node.childNodes).map((child) => walk(child, depth)).join("");

        if (tag === "pre") {
          const codeNode = node.querySelector("code");
          const code = (codeNode?.textContent || node.textContent || "").replace(/\n+$/, "");
          const language = codeNode?.className.match(/language-([\w-]+)/)?.[1]
            || node.getAttribute("data-language")
            || "";
          return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
        }
        if (tag === "code") return `\`${children().replace(/`/g, "\\`")}\``;
        if (tag === "br") return "\n";
        if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
        if (tag === "p") return `${children().trim()}\n\n`;
        if (tag === "strong" || tag === "b") return `**${children()}**`;
        if (tag === "em" || tag === "i") return `*${children()}*`;
        if (tag === "blockquote") return children().split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
        if (tag === "a") {
          const label = children().trim();
          const href = node.getAttribute("href") || "";
          return /^https?:\/\//i.test(href) && label ? `[${label}](${href})` : label;
        }
        if (tag === "li") {
          const parent = node.parentElement?.tagName.toLowerCase();
          const marker = parent === "ol"
            ? `${Array.from(node.parentElement?.children || []).indexOf(node) + 1}.`
            : "-";
          return `${"  ".repeat(depth)}${marker} ${children().trim()}\n`;
        }
        if (tag === "ul" || tag === "ol") {
          return `\n${Array.from(node.childNodes).map((child) => walk(child, depth + 1)).join("")}\n`;
        }
        if (tag === "table") {
          const rows = Array.from(node.querySelectorAll("tr")).map((row) =>
            Array.from(row.querySelectorAll("th, td")).map((cell) =>
              normalize(cell.textContent || "").replace(/\|/g, "\\|")));
          if (!rows.length) return "";
          const width = Math.max(...rows.map((row) => row.length));
          const normalizedRows = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
          const header = normalizedRows[0];
          return `\n\n| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n${normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
        }
        if (["div", "section", "article"].includes(tag)) return children();
        return children();
      };

      const markdownRoot = root.querySelector(".markdown, .prose");
      if (!markdownRoot) return "";
      return normalize(walk(markdownRoot));
    });
  }

  async waitForThreadUrl() {
    if (isChatGptThreadUrl(this.page.url())) return this.page.url();
    await this.page.waitForURL(
      (url) => isChatGptThreadUrl(url.toString()),
      { timeout: 2_500 },
    ).catch(() => undefined);
    return isChatGptThreadUrl(this.page.url()) ? this.page.url() : null;
  }

  async createCompletionStream(prompt, { threadUrl = null, modelId = "gpt-5.5" } = {}) {
    await this.ensureReady();
    await this.openThread(threadUrl);
    const selectedModel = await this.switchModel(modelId);
    const responseCountBefore = await this.assistantBlocks().count();
    const textarea = this.page.locator(SELECTORS.input).first();
    await textarea.fill(prompt);

    const send = this.page.locator(SELECTORS.send).first();
    if (await send.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await send.click();
    } else {
      await textarea.press("Enter");
    }

    const resolvedThreadUrl = await this.waitForThreadUrl();
    const encoder = new TextEncoder();
    let cancelled = false;

    const cancel = () => {
      cancelled = true;
      const stop = this.page?.locator(SELECTORS.stop).first();
      if (stop) {
        void stop.isVisible({ timeout: 500 })
          .then((visible) => visible && stop.click())
          .catch(() => undefined);
      }
    };

    const stream = new ReadableStream({
      start: (controller) => {
        this.activeCancellation = cancel;
        void this.monitorGeneration({
          controller,
          encoder,
          responseCountBefore,
          isCancelled: () => cancelled,
        }).finally(() => {
          if (this.activeCancellation === cancel) this.activeCancellation = null;
        });
      },
      cancel,
    });

    return {
      stream,
      cancel,
      modelId: selectedModel,
      threadUrl: resolvedThreadUrl,
    };
  }

  async monitorGeneration({ controller, encoder, responseCountBefore, isCancelled }) {
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    let previous = "";
    let stopSeen = false;
    let stableChecks = 0;
    let idleChecks = 0;
    let lastChangeAt = Date.now();

    const emit = (event) => {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    };

    try {
      while (Date.now() < deadline && !isCancelled()) {
        const stopVisible = await this.page.locator(SELECTORS.stop).first()
          .isVisible({ timeout: 250 })
          .catch(() => false);
        if (stopVisible) stopSeen = true;
        idleChecks = stopSeen && !stopVisible ? idleChecks + 1 : 0;

        const current = await this.extractLastAssistantMarkdown(responseCountBefore)
          .catch(() => "");
        const delta = incrementalDelta(previous, current);
        if (delta) {
          previous = current;
          stableChecks = 0;
          lastChangeAt = Date.now();
          emit({ type: "content", delta });
        } else if (current && current === previous) {
          stableChecks += 1;
        }

        const generationFinished = stopSeen
          ? !stopVisible && (stableChecks >= 3 || idleChecks >= 8)
          : current && stableChecks >= 8 && Date.now() - lastChangeAt >= 1_500;

        if (generationFinished) {
          emit({ type: "done" });
          controller.close();
          return;
        }

        await this.page.waitForTimeout(POLL_INTERVAL_MS);
      }

      if (isCancelled()) {
        emit({ type: "cancelled" });
        controller.close();
        return;
      }

      await this.stop();
      throw new Error("CHATGPT_TIMEOUT");
    } catch (error) {
      try { controller.error(error); } catch { /* Stream already closed. */ }
    }
  }

  async stop() {
    if (!this.page) return false;
    const stop = this.page.locator(SELECTORS.stop).first();
    if (!(await stop.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
    await stop.click();
    return true;
  }

  currentThreadUrl() {
    const value = this.page?.url() || "";
    return isChatGptThreadUrl(value) ? value : null;
  }

  async close() {
    this.isReady = false;
    this.activeCancellation?.();
    if (this.context) await this.context.close();
  }
}

export default new ChatGptBridge();

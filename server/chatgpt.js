/* global process, Buffer */
import "dotenv/config";
import { execFile, execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.CHATGPT_STATE_DIR
  ? path.resolve(process.env.CHATGPT_STATE_DIR)
  : path.join(__dirname, "state");
const PROFILE_DIR = path.join(STATE_DIR, "chrome-profile");
const EXTENSION_DIR = path.resolve(__dirname, "..", "extension");
const EXTENSION_KEY_FILE = path.join(STATE_DIR, "extension-signing-key.pem");
const EXTENSION_CRX_FILE = path.join(STATE_DIR, "skmake-chatgpt-bridge.crx");
const TARGET_URL = "https://chatgpt.com/";
const DISPLAY = process.env.DISPLAY || ":99";
const EXTENSION_PORT = 3002;
const GENERATION_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.CHATGPT_GENERATION_TIMEOUT_MS || 480_000),
);

fs.mkdirSync(PROFILE_DIR, { recursive: true });

function isLoopback(address = "") {
  return address === "127.0.0.1"
    || address === "::1"
    || address === "::ffff:127.0.0.1";
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

function xdotool(args) {
  return new Promise((resolve, reject) => {
    execFile("xdotool", args, { env: { ...process.env, DISPLAY } }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function captureRootWindow() {
  return new Promise((resolve, reject) => {
    execFile(
      "import",
      ["-display", DISPLAY, "-window", "root", "png:-"],
      {
        encoding: null,
        maxBuffer: 20 * 1024 * 1024,
        env: { ...process.env, DISPLAY },
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(Buffer.from(stdout));
      },
    );
  });
}

function extensionIdFromKey(keyFile) {
  const publicKey = crypto.createPublicKey(fs.readFileSync(keyFile)).export({
    type: "spki",
    format: "der",
  });
  return crypto
    .createHash("sha256")
    .update(publicKey)
    .digest()
    .subarray(0, 16)
    .toString("hex")
    .replace(/[0-9a-f]/g, (character) =>
      String.fromCharCode("a".charCodeAt(0) + Number.parseInt(character, 16)));
}

export function incrementalDelta(previous, incoming) {
  if (!incoming || incoming === previous) return "";
  if (!previous) return incoming;
  if (incoming.startsWith(previous)) return incoming.slice(previous.length);
  if (previous.startsWith(incoming) || previous.endsWith(incoming)) return "";
  return "";
}

export function runtimeExtensionVersion(date = new Date()) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000) + 1;
  const twoSecondSlot = Math.floor((
    date.getUTCHours() * 3_600
    + date.getUTCMinutes() * 60
    + date.getUTCSeconds()
  ) / 2);
  return `${date.getUTCFullYear()}.${dayOfYear}.${twoSecondSlot}`;
}

export class ChatGptBridge {
  constructor() {
    this.wss = null;
    this.socket = null;
    this.chromeProcess = null;
    this.isReady = false;
    this.lastStatus = {
      ready: false,
      url: null,
      title: "",
      modelLabel: "",
    };
    this.generations = new Map();
  }

  startExtensionServer() {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      host: "127.0.0.1",
      port: EXTENSION_PORT,
    });

    this.wss.on("listening", () => {
      console.log(`Chrome extension channel ready on 127.0.0.1:${EXTENSION_PORT}`);
    });

    this.wss.on("connection", (socket, request) => {
      const origin = request.headers.origin || "";
      if (!isLoopback(request.socket.remoteAddress) || !origin.startsWith("chrome-extension://")) {
        socket.close(1008, "Local Chrome extension only");
        return;
      }

      this.socket?.close(1012, "Replaced by a newer extension connection");
      this.socket = socket;
      console.log("SKMake Chrome extension connected");

      socket.on("message", (raw) => this.handleExtensionMessage(raw));
      socket.on("close", () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.isReady = false;
        this.lastStatus = { ...this.lastStatus, ready: false };
        this.failAllGenerations(new Error("CHATGPT_EXTENSION_DISCONNECTED"));
        console.log("SKMake Chrome extension disconnected");
      });
      socket.on("error", (error) => {
        console.error("Chrome extension channel error", error.message);
      });

      this.send({
        type: "command",
        action: "status",
        requestId: crypto.randomUUID(),
      });
    });

    this.wss.on("error", (error) => {
      console.error("Chrome extension server error", error);
    });
  }

  launchChrome() {
    if (process.env.CHATGPT_CHROME_AUTOSTART === "false") {
      console.log("Chrome autostart is disabled");
      return;
    }

    const executable = process.env.CHATGPT_CHROME_BIN || "google-chrome";
    const extensionId = this.packageExtension(executable);
    this.removeStaleProfileLocks();
    this.removeManagedExtensionCache(extensionId);
    const args = [
      `--user-data-dir=${PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--password-store=basic",
      "--window-position=0,0",
      "--window-size=1440,900",
      TARGET_URL,
    ];

    this.chromeProcess = spawn(executable, args, {
      env: { ...process.env, DISPLAY },
      stdio: "inherit",
    });

    this.chromeProcess.once("spawn", () => {
      console.log(`Google Chrome started without WebDriver; extension ${extensionId} is managed locally`);
    });
    this.chromeProcess.once("error", (error) => {
      console.error("Google Chrome failed to start", error);
    });
    this.chromeProcess.once("exit", (code, signal) => {
      this.chromeProcess = null;
      this.isReady = false;
      this.lastStatus = { ...this.lastStatus, ready: false };
      console.log(`Google Chrome exited (${signal || code || 0})`);
    });
  }

  removeStaleProfileLocks() {
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      fs.rmSync(path.join(PROFILE_DIR, name), {
        force: true,
        recursive: true,
      });
    }
  }

  removeManagedExtensionCache(extensionId) {
    const installedExtension = path.join(PROFILE_DIR, "Default", "Extensions", extensionId);
    fs.rmSync(installedExtension, { force: true, recursive: true });
  }

  packageExtension(executable) {
    const generatedCrx = `${EXTENSION_DIR}.crx`;
    const generatedKey = `${EXTENSION_DIR}.pem`;
    const manifestPath = path.join(EXTENSION_DIR, "manifest.json");
    const originalManifest = fs.readFileSync(manifestPath, "utf8");
    const packagedVersion = runtimeExtensionVersion();
    const manifest = JSON.parse(originalManifest);
    manifest.version = packagedVersion;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    fs.rmSync(generatedCrx, { force: true });

    const args = [
      "--no-sandbox",
      "--disable-gpu",
      `--pack-extension=${EXTENSION_DIR}`,
    ];
    if (fs.existsSync(EXTENSION_KEY_FILE)) {
      args.push(`--pack-extension-key=${EXTENSION_KEY_FILE}`);
    }

    try {
      execFileSync(executable, args, {
        env: { ...process.env, DISPLAY },
        stdio: "ignore",
        timeout: 60_000,
      });
    } finally {
      fs.writeFileSync(manifestPath, originalManifest, "utf8");
    }

    if (!fs.existsSync(EXTENSION_KEY_FILE)) {
      if (!fs.existsSync(generatedKey)) throw new Error("EXTENSION_KEY_NOT_CREATED");
      fs.copyFileSync(generatedKey, EXTENSION_KEY_FILE);
      fs.chmodSync(EXTENSION_KEY_FILE, 0o600);
      fs.rmSync(generatedKey, { force: true });
    }
    if (!fs.existsSync(generatedCrx)) throw new Error("EXTENSION_PACKAGE_NOT_CREATED");
    fs.copyFileSync(generatedCrx, EXTENSION_CRX_FILE);
    fs.rmSync(generatedCrx, { force: true });

    const extensionId = extensionIdFromKey(EXTENSION_KEY_FILE);
    const externalDirectory = "/opt/google/chrome/extensions";
    fs.mkdirSync(externalDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(externalDirectory, `${extensionId}.json`),
      JSON.stringify({
        external_crx: EXTENSION_CRX_FILE,
        external_version: packagedVersion,
      }),
      { encoding: "utf8", mode: 0o644 },
    );
    console.log(`Packaged Chrome extension ${extensionId} version ${packagedVersion}`);
    return extensionId;
  }

  async init() {
    this.startExtensionServer();
    this.launchChrome();
  }

  handleExtensionMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;

    if (message.type === "hello" || message.type === "status") {
      this.updateStatus(message);
      return;
    }

    if (message.type !== "generation" || typeof message.requestId !== "string") {
      return;
    }

    const generation = this.generations.get(message.requestId);
    if (!generation) return;

    if (message.event === "thread" && isChatGptThreadUrl(message.url)) {
      generation.threadUrl = message.url;
      this.updateStatus({ url: message.url });
      return;
    }

    if (message.event === "content" && typeof message.content === "string") {
      const delta = incrementalDelta(generation.previous, message.content);
      if (!delta) return;
      generation.previous = message.content;
      generation.controller.enqueue(
        generation.encoder.encode(`${JSON.stringify({ type: "content", delta })}\n`),
      );
      return;
    }

    if (message.event === "reasoning" && typeof message.content === "string") {
      const delta = incrementalDelta(generation.previousReasoning, message.content);
      if (!delta) return;
      generation.previousReasoning = message.content;
      generation.controller.enqueue(
        generation.encoder.encode(`${JSON.stringify({ type: "reasoning", delta })}\n`),
      );
      return;
    }

    if (message.event === "search") {
      const sources = Array.isArray(message.sources)
        ? message.sources
          .filter((source) => source && typeof source.title === "string" && typeof source.url === "string")
          .slice(0, 20)
        : [];
      generation.controller.enqueue(
        generation.encoder.encode(`${JSON.stringify({
          type: "search",
          status: message.status === "COMPLETED" ? "COMPLETED" : "RUNNING",
          searches: Number.isFinite(message.searches) ? Math.max(1, message.searches) : 1,
          sources,
        })}\n`),
      );
      return;
    }

    if (message.event === "done") {
      this.finishGeneration(message.requestId, { type: "done" });
      return;
    }

    if (message.event === "cancelled") {
      this.finishGeneration(message.requestId, { type: "cancelled" });
      return;
    }

    if (message.event === "error") {
      this.failGeneration(
        message.requestId,
        new Error(typeof message.code === "string" ? message.code : "CHATGPT_EXTENSION_ERROR"),
      );
    }
  }

  updateStatus(status) {
    this.lastStatus = {
      ...this.lastStatus,
      ...(typeof status.url === "string" ? { url: status.url } : {}),
      ...(typeof status.title === "string" ? { title: status.title } : {}),
      ...(typeof status.modelLabel === "string" ? { modelLabel: status.modelLabel } : {}),
      ...(typeof status.ready === "boolean" ? { ready: status.ready } : {}),
    };
    this.isReady = Boolean(this.socket && this.lastStatus.ready);
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("CHATGPT_EXTENSION_DISCONNECTED");
    }
    this.socket.send(JSON.stringify(payload));
  }

  async setupStatus() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({
        type: "command",
        action: "status",
        requestId: crypto.randomUUID(),
      });
    }
    return {
      ...this.lastStatus,
      ready: this.isReady,
      extensionConnected: this.socket?.readyState === WebSocket.OPEN,
      browser: "Google Chrome",
      automation: "extension",
      headless: false,
    };
  }

  async setupScreenshot() {
    return captureRootWindow();
  }

  async setupClick(x, y) {
    await xdotool(["mousemove", String(Math.round(x)), String(Math.round(y)), "click", "1"]);
    return this.setupStatus();
  }

  async setupType(text) {
    await xdotool(["type", "--clearmodifiers", "--delay", "20", "--", text]);
    return this.setupStatus();
  }

  async setupPress(key) {
    const keys = { Enter: "Return", Tab: "Tab", Escape: "Escape" };
    await xdotool(["key", "--clearmodifiers", keys[key] || key]);
    return this.setupStatus();
  }

  async ensureReady() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("CHATGPT_EXTENSION_DISCONNECTED");
    }
    if (!this.isReady) throw new Error("CHATGPT_LOGIN_REQUIRED");
  }

  async createCompletionStream(prompt, { threadUrl = null, modelId = "gpt-5.5" } = {}) {
    await this.ensureReady();
    const requestId = crypto.randomUUID();
    const encoder = new TextEncoder();
    let cancelled = false;

    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: "command",
          action: "cancel",
          requestId,
        }));
      }
    };

    const stream = new ReadableStream({
      start: (controller) => {
        this.generations.set(requestId, {
          controller,
          encoder,
          previous: "",
          previousReasoning: "",
          threadUrl,
          modelId,
          cancelled: () => cancelled,
        });
      },
      cancel,
    });

    try {
      this.send({
        type: "command",
        action: "generate",
        requestId,
        prompt,
        threadUrl,
        modelId,
        timeoutMs: GENERATION_TIMEOUT_MS,
      });
    } catch (error) {
      this.failGeneration(requestId, error);
      throw error;
    }

    return {
      stream,
      cancel,
      modelId,
      threadUrl,
      requestId,
    };
  }

  finishGeneration(requestId, event) {
    const generation = this.generations.get(requestId);
    if (!generation) return;
    this.generations.delete(requestId);
    try {
      generation.controller.enqueue(
        generation.encoder.encode(`${JSON.stringify(event)}\n`),
      );
      generation.controller.close();
    } catch {
      // Consumer already closed the stream.
    }
  }

  failGeneration(requestId, error) {
    const generation = this.generations.get(requestId);
    if (!generation) return;
    this.generations.delete(requestId);
    try {
      generation.controller.error(error);
    } catch {
      // Consumer already closed the stream.
    }
  }

  failAllGenerations(error) {
    for (const requestId of [...this.generations.keys()]) {
      this.failGeneration(requestId, error);
    }
  }

  async stop() {
    if (!this.generations.size) return false;
    for (const requestId of this.generations.keys()) {
      this.send({ type: "command", action: "cancel", requestId });
    }
    return true;
  }

  currentThreadUrl() {
    return isChatGptThreadUrl(this.lastStatus.url) ? this.lastStatus.url : null;
  }

  async close() {
    this.isReady = false;
    this.failAllGenerations(new Error("GENERATION_CANCELLED"));
    this.socket?.close(1001, "Bridge shutting down");
    this.wss?.close();
    if (this.chromeProcess && !this.chromeProcess.killed) {
      this.chromeProcess.kill("SIGTERM");
    }
  }
}

export default new ChatGptBridge();

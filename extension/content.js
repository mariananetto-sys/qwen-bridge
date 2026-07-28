/* global chrome */
const INPUT_SELECTORS = [
  'textarea[name="prompt-textarea"]',
  "#prompt-textarea",
  '[contenteditable="true"][data-virtualkeyboard="true"]',
  'main [contenteditable="true"]',
];
const SEND_SELECTOR = [
  '[data-testid="send-button"]',
  'button[aria-label="Enviar prompt"]',
  'button[aria-label="Send prompt"]',
].join(",");
const STOP_SELECTOR = [
  '[data-testid="stop-button"]',
  'button[aria-label*="Parar"]',
  'button[aria-label*="Stop"]',
].join(",");
const ASSISTANT_SELECTOR = 'main [data-message-author-role="assistant"]';
const USER_SELECTOR = 'main [data-message-author-role="user"]';
const MODEL_LEVELS = {
  "gpt-5.5": ["Instantâneo", "Instant"],
  "gpt-5.6-sol": ["Médio", "Medium"],
  "gpt-5.6-sol-thinking": ["Alto", "High"],
};

let activeGeneration = null;

function visible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  return style.visibility !== "hidden"
    && style.display !== "none"
    && box.width > 0
    && box.height > 0;
}

function normalizedText(element) {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
}

function exactLabel(element, labels) {
  const value = normalizedText(element).toLocaleLowerCase();
  return labels.some((label) => label.toLocaleLowerCase() === value);
}

function findInput() {
  for (const selector of INPUT_SELECTORS) {
    const element = document.querySelector(selector);
    if (visible(element)) return element;
  }
  return null;
}

function findModelTrigger() {
  const allLabels = Object.values(MODEL_LEVELS).flat();
  const buttons = [...document.querySelectorAll("button")].filter(visible);
  return buttons.reverse().find((button) => exactLabel(button, allLabels)) || null;
}

function currentStatus() {
  const input = findInput();
  return {
    ready: Boolean(input),
    url: location.href,
    title: document.title,
    modelLabel: normalizedText(findModelTrigger()),
  };
}

function reportStatus() {
  chrome.runtime.sendMessage({
    type: "bridge-status",
    status: currentStatus(),
  }).catch(() => undefined);
}

function generationEvent(requestId, event, detail = {}) {
  chrome.runtime.sendMessage({
    type: "bridge-generation",
    requestId,
    event,
    ...detail,
  }).catch(() => undefined);
}

function waitFor(predicate, timeoutMs = 30_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      const value = predicate();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("CHATGPT_INTERFACE_TIMEOUT"));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

async function switchModel(modelId) {
  const targetLabels = MODEL_LEVELS[modelId];
  if (!targetLabels) throw new Error("MODEL_UNAVAILABLE");

  const trigger = await waitFor(findModelTrigger, 10_000);
  if (exactLabel(trigger, targetLabels)) return;

  trigger.click();
  const target = await waitFor(() => {
    const candidates = [
      ...document.querySelectorAll('button, [role="menuitem"], [role="option"]'),
    ].filter((element) => visible(element) && exactLabel(element, targetLabels));
    return candidates.at(-1) || null;
  }, 5_000);
  target.click();

  await waitFor(() => {
    const selected = findModelTrigger();
    return selected && exactLabel(selected, targetLabels);
  }, 5_000);
}

function fillPrompt(input, prompt) {
  input.focus();
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(input, prompt);
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: prompt,
    }));
    return;
  }

  input.textContent = "";
  document.execCommand("insertText", false, prompt);
  input.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: prompt,
  }));
}

function assistantBlocks() {
  return [...document.querySelectorAll(ASSISTANT_SELECTOR)];
}

function userBlocks() {
  return [...document.querySelectorAll(USER_SELECTOR)];
}

function isThreadPage() {
  return /^\/c\/[a-z0-9-]+\/?$/i.test(location.pathname);
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value, location.href);
    const nested = url.hostname.endsWith("google.com")
      ? url.searchParams.get("url") || url.searchParams.get("q")
      : null;
    const resolved = nested ? new URL(nested) : url;
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    if (/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/i.test(resolved.hostname)) return null;
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return null;
  }
}

function sourceTitle(anchor, url) {
  const label = [
    anchor.getAttribute("aria-label"),
    anchor.getAttribute("title"),
    normalizedText(anchor),
  ].find((value) => value && !/^\d+$/.test(value.trim()));
  if (label) return label.replace(/\s+/g, " ").trim().slice(0, 180);
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Fonte da web";
  }
}

function extractWebActivity(root) {
  if (!(root instanceof HTMLElement)) return { markers: 0, sources: [] };
  const markerPattern = /\b(?:searched|searching|search)\s+(?:the\s+)?web\b|pesquis(?:ou|ando|ar|a)\s+(?:na\s+)?web|busc(?:ou|ando|ar)\s+(?:na\s+)?web/i;
  const markerNodes = [...root.querySelectorAll("button, [role='button'], [data-testid*='search'], [aria-label]")]
    .filter((element) => markerPattern.test(`${normalizedText(element)} ${element.getAttribute("aria-label") || ""}`));
  const sources = [];
  for (const anchor of root.querySelectorAll("a[href]")) {
    const url = safeExternalUrl(anchor.getAttribute("href") || "");
    if (!url || sources.some((source) => source.url === url)) continue;
    sources.push({ title: sourceTitle(anchor, url), url });
    if (sources.length >= 30) break;
  }
  return { markers: markerNodes.length, sources };
}

function setNativeInputValue(input, value) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function ensureSkmakeConversationTitle() {
  if (!/^\/c\/[a-z0-9-]+\/?$/i.test(location.pathname)) return;
  const link = await waitFor(() => [...document.querySelectorAll('a[href*="/c/"]')].find((candidate) => {
    try {
      return new URL(candidate.getAttribute("href") || "", location.href).pathname.replace(/\/$/, "")
        === location.pathname.replace(/\/$/, "");
    } catch {
      return false;
    }
  }) || null, 5_000).catch(() => null);
  if (!(link instanceof HTMLElement)) return;

  const currentTitle = normalizedText(link).replace(/\s*\[SKMAKE\]\s*$/i, "").trim();
  if (!currentTitle || /\[SKMAKE\]\s*$/i.test(normalizedText(link))) return;
  const container = link.closest("li") || link.parentElement?.parentElement || link.parentElement;
  if (!(container instanceof HTMLElement)) return;
  container.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

  const menuButton = await waitFor(() => [...container.querySelectorAll("button")].find((button) => {
    const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
    return /option|menu|more|opç|mais/i.test(label);
  }) || null, 2_500).catch(() => null);
  if (!(menuButton instanceof HTMLElement)) return;
  menuButton.click();

  const renameButton = await waitFor(() => [...document.querySelectorAll('button, [role="menuitem"]')].find((element) =>
    visible(element) && /\b(rename|renomear)\b/i.test(normalizedText(element))) || null, 2_500).catch(() => null);
  if (!(renameButton instanceof HTMLElement)) return;
  renameButton.click();

  const titleInput = await waitFor(() => {
    const candidates = [...document.querySelectorAll('input[type="text"], input:not([type])')].filter(visible);
    return candidates.find((input) => /rename|renomear|title|título/i.test(`${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""}`))
      || candidates.at(-1)
      || null;
  }, 2_500).catch(() => null);
  if (!(titleInput instanceof HTMLInputElement)) return;
  setNativeInputValue(titleInput, `${currentTitle} [SKMAKE]`);
  titleInput.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
  }));
}

function extractMarkdown(root) {
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
    const children = () => [...node.childNodes].map((child) => walk(child, depth)).join("");

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
    if (tag === "blockquote") {
      return `${children().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }
    if (tag === "a") {
      const label = children().trim();
      const href = node.getAttribute("href") || "";
      return /^https?:\/\//i.test(href) && label ? `[${label}](${href})` : label;
    }
    if (tag === "li") {
      const parent = node.parentElement?.tagName.toLowerCase();
      const marker = parent === "ol"
        ? `${[...(node.parentElement?.children || [])].indexOf(node) + 1}.`
        : "-";
      return `${"  ".repeat(depth)}${marker} ${children().trim()}\n`;
    }
    if (tag === "ul" || tag === "ol") {
      return `\n${[...node.childNodes].map((child) => walk(child, depth + 1)).join("")}\n`;
    }
    if (tag === "table") {
      const rows = [...node.querySelectorAll("tr")].map((row) =>
        [...row.querySelectorAll("th, td")].map((cell) =>
          normalize(cell.textContent || "").replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const normalizedRows = rows.map((row) => [
        ...row,
        ...Array(Math.max(0, width - row.length)).fill(""),
      ]);
      const header = normalizedRows[0];
      return `\n\n| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n${normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
    }
    return children();
  };

  const markdownRoot = root.querySelector(".markdown, .prose");
  return markdownRoot ? normalize(walk(markdownRoot)) : "";
}

async function monitorGeneration(requestId, assistantBaseline, timeoutMs, webBaseline) {
  const deadline = Date.now() + Math.max(30_000, Number(timeoutMs || 480_000));
  let previous = "";
  let stopSeen = false;
  let stableChecks = 0;
  let idleChecks = 0;
  let lastChangeAt = Date.now();
  let threadReported = false;
  let previousWebSignature = "";

  while (Date.now() < deadline && activeGeneration?.requestId === requestId) {
    if (!threadReported && /^https:\/\/chatgpt\.com\/c\/[a-z0-9-]+\/?$/i.test(location.href)) {
      generationEvent(requestId, "thread", { url: location.href });
      threadReported = true;
    }

    const stopVisible = visible(document.querySelector(STOP_SELECTOR));
    if (stopVisible) stopSeen = true;
    idleChecks = stopSeen && !stopVisible ? idleChecks + 1 : 0;

    const blocks = assistantBlocks();
    const currentBlock = blocks.findLast((block) => !assistantBaseline.has(block)) || null;
    const current = currentBlock ? extractMarkdown(currentBlock) : "";
    if (current && current !== previous) {
      previous = current;
      stableChecks = 0;
      lastChangeAt = Date.now();
      generationEvent(requestId, "content", { content: current });
    } else if (current) {
      stableChecks += 1;
    }

    const pageActivity = extractWebActivity(document.querySelector("main"));
    const currentActivity = extractWebActivity(currentBlock);
    const baselineUrls = new Set(webBaseline.sources.map(({ url }) => url));
    const sources = [...currentActivity.sources, ...pageActivity.sources]
      .filter((source, index, items) =>
        !baselineUrls.has(source.url)
        && items.findIndex((item) => item.url === source.url) === index)
      .slice(0, 20);
    const markerCount = Math.max(0, pageActivity.markers - webBaseline.markers);
    const searches = Math.max(markerCount, sources.length ? 1 : 0);
    if (searches || sources.length) {
      const status = stopVisible ? "RUNNING" : "COMPLETED";
      const signature = JSON.stringify({ status, searches, sources });
      if (signature !== previousWebSignature) {
        previousWebSignature = signature;
        generationEvent(requestId, "search", { status, searches, sources });
      }
    }

    const finished = stopSeen
      ? !stopVisible && (stableChecks >= 3 || idleChecks >= 8)
      : current && stableChecks >= 8 && Date.now() - lastChangeAt >= 1_500;
    if (finished) {
      void ensureSkmakeConversationTitle().catch(() => undefined);
      activeGeneration = null;
      generationEvent(requestId, "done");
      reportStatus();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 160));
  }

  if (activeGeneration?.requestId !== requestId) return;
  activeGeneration = null;
  document.querySelector(STOP_SELECTOR)?.click();
  generationEvent(requestId, "error", { code: "CHATGPT_TIMEOUT" });
}

async function startGeneration(message) {
  if (activeGeneration) throw new Error("CHATGPT_GENERATION_BUSY");
  await switchModel(message.modelId);
  let input = await waitFor(findInput, 30_000);
  const assistantBaseline = new Set(assistantBlocks());
  const userBaseline = new Set(userBlocks());
  const threadBefore = isThreadPage() ? location.pathname : null;
  const webBaseline = extractWebActivity(document.querySelector("main"));
  activeGeneration = { requestId: message.requestId };

  const submit = async () => {
    fillPrompt(input, message.prompt);
    const send = await waitFor(() => {
      const button = document.querySelector(SEND_SELECTOR);
      return visible(button) && !button.disabled ? button : null;
    }, 5_000).catch(() => null);
    if (send) send.click();
    else {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }));
    }
  };

  const submitted = () => {
    const createdThread = isThreadPage() && location.pathname !== threadBefore;
    const addedUserMessage = userBlocks().some((block) => !userBaseline.has(block));
    return createdThread || addedUserMessage || visible(document.querySelector(STOP_SELECTOR));
  };

  try {
    await submit();
    let accepted = await waitFor(() => submitted(), 8_000, 120).then(() => true).catch(() => false);
    if (!accepted) {
      input = await waitFor(findInput, 5_000);
      await submit();
      accepted = await waitFor(() => submitted(), 8_000, 120).then(() => true).catch(() => false);
    }
    if (!accepted) throw new Error("CHATGPT_SUBMISSION_FAILED");
  } catch (error) {
    activeGeneration = null;
    throw error;
  }

  void monitorGeneration(message.requestId, assistantBaseline, message.timeoutMs, webBaseline);
}

function cancelGeneration(requestId) {
  if (!activeGeneration || activeGeneration.requestId !== requestId) return false;
  document.querySelector(STOP_SELECTOR)?.click();
  activeGeneration = null;
  generationEvent(requestId, "cancelled");
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "status") {
    sendResponse(currentStatus());
    return;
  }
  if (message?.action === "cancel") {
    sendResponse({ cancelled: cancelGeneration(message.requestId) });
    return;
  }
  if (message?.action === "generate") {
    void startGeneration(message)
      .then(() => sendResponse({ accepted: true }))
      .catch((error) => {
        generationEvent(message.requestId, "error", {
          code: error instanceof Error ? error.message : "CHATGPT_EXTENSION_ERROR",
        });
        sendResponse({ accepted: false });
      });
    return true;
  }
});

new MutationObserver(() => {
  clearTimeout(globalThis.__skmakeStatusTimer);
  globalThis.__skmakeStatusTimer = setTimeout(reportStatus, 250);
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
});

reportStatus();

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
const ATTACHMENT_TRIGGER_PATTERN = /attach|upload|add (?:photos?|files?)|anexar|carregar|adicionar (?:fotos?|arquivos?)/i;
const ASSISTANT_SELECTOR = 'main [data-message-author-role="assistant"]';
const USER_SELECTOR = 'main [data-message-author-role="user"]';
const MODEL_LEVELS = {
  "gpt-5.5-instant": [
    "Instant 5.5",
    "5.5 Instant",
    "Instantâneo 5.5",
    "5.5 Instantâneo",
    "Instantâneo",
    "Instant",
  ],
  "gpt-5.5-medium": ["Medium", "Médio", "5.5 Medium", "Medium 5.5", "5.5 Médio", "Médio 5.5"],
  "gpt-5.6-sol": ["High", "Alto", "5.6 Sol High", "High 5.6 Sol", "5.6 Sol Alto", "Alto 5.6 Sol"],
  "gpt-5.6-sol-thinking": ["High", "Alto", "5.6 Sol High", "High 5.6 Sol", "5.6 Sol Alto", "Alto 5.6 Sol"],
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

function optionLabel(element, labels) {
  const value = normalizedText(element).toLocaleLowerCase();
  return labels.some((label) => {
    const expected = label.toLocaleLowerCase();
    return value === expected || value.startsWith(`${expected} `);
  });
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

function findVisibleOption(labels, excluded = null) {
  const candidates = [
    ...document.querySelectorAll(
      'button, [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], div, span',
    ),
  ].filter((element) => {
    if (element === excluded) return false;
    if (!visible(element)) return false;
    const text = normalizedText(element);
    if (!text || text.length > 100 || !optionLabel(element, labels)) return false;
    return ![...element.children].some((child) =>
      visible(child) && normalizedText(child).length <= text.length && optionLabel(child, labels));
  });
  return candidates.at(-1) || null;
}

function activateElement(element) {
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  const box = element.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
    button: 0,
    buttons: 1,
  };
  element.dispatchEvent(new PointerEvent("pointerdown", init));
  element.dispatchEvent(new MouseEvent("mousedown", init));
  element.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
  element.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
  element.click();
}

function visibleModelLabels() {
  const known = [...new Set([
    ...Object.values(MODEL_LEVELS).flat(),
    "GPT-5.6 Sol",
    "GPT-5.5",
    "GPT-5.3",
    "o3",
  ])];
  return known.filter((label) => findVisibleOption([label])).slice(0, 20);
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

function waitFor(predicate, timeoutMs = 30_000, intervalMs = 100, errorCode = "CHATGPT_INTERFACE_TIMEOUT") {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      const value = predicate();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(errorCode));
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

  const trigger = await waitFor(findModelTrigger, 10_000, 100, "MODEL_SELECTOR_NOT_FOUND");
  if (!exactLabel(trigger, targetLabels)) {
    activateElement(trigger);
    const target = await waitFor(
      () => findVisibleOption(targetLabels),
      5_000,
      100,
      "MODEL_UNAVAILABLE",
    );
    activateElement(target);
  }

  await waitFor(() => {
    const selected = findModelTrigger();
    return selected && exactLabel(selected, targetLabels);
  }, 5_000, 100, "MODEL_SELECTION_FAILED");
}

async function ensureIdle() {
  const stop = document.querySelector(STOP_SELECTOR);
  if (!visible(stop)) return;
  stop.click();
  await waitFor(
    () => !visible(document.querySelector(STOP_SELECTOR)),
    20_000,
    120,
    "CHATGPT_GENERATION_BUSY",
  );
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

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function findAttachmentInput() {
  return [...document.querySelectorAll('input[type="file"]')]
    .find((input) => input instanceof HTMLInputElement && !input.disabled) || null;
}

function findAttachmentTrigger() {
  return [...document.querySelectorAll("button, [role='button']")]
    .filter((element) => {
      const label = `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${normalizedText(element)}`;
      return visible(element) && ATTACHMENT_TRIGGER_PATTERN.test(label);
    })
    .at(-1) || null;
}

async function attachFiles(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return;
  let input = findAttachmentInput();
  if (!input) {
    const trigger = findAttachmentTrigger();
    if (trigger) activateElement(trigger);
    input = await waitFor(findAttachmentInput, 5_000, 100, "CHATGPT_ATTACHMENT_INPUT_NOT_FOUND");
  }
  if (!(input instanceof HTMLInputElement)) throw new Error("CHATGPT_ATTACHMENT_INPUT_NOT_FOUND");

  const transfer = new DataTransfer();
  for (const attachment of attachments) {
    if (
      !attachment
      || typeof attachment.name !== "string"
      || typeof attachment.dataBase64 !== "string"
    ) throw new Error("CHATGPT_ATTACHMENT_INVALID");
    transfer.items.add(new File(
      [decodeBase64(attachment.dataBase64)],
      attachment.name,
      { type: attachment.mimeType || "application/octet-stream" },
    ));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await new Promise((resolve) => setTimeout(resolve, 700));
}

function assistantBlocks() {
  return [...document.querySelectorAll(ASSISTANT_SELECTOR)];
}

function userBlocks() {
  return [...document.querySelectorAll(USER_SELECTOR)];
}

function promptFingerprint(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return {
    head: normalized.slice(0, 120),
    tail: normalized.slice(-120),
  };
}

function findSubmittedUser(prompt, baseline = new Set()) {
  const { head, tail } = promptFingerprint(prompt);
  const blocks = userBlocks();
  const matching = blocks.filter((block) => {
    const text = normalizedText(block);
    return (!head || text.includes(head)) && (!tail || text.includes(tail));
  });
  return matching.at(-1)
    || blocks.filter((block) => !baseline.has(block)).at(-1)
    || null;
}

function appearsAfter(anchor, candidate) {
  if (!(anchor instanceof Node) || !(candidate instanceof Node)) return false;
  return Boolean(anchor.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING);
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

function visibleReasoningEntries(root) {
  if (!(root instanceof HTMLElement)) return [];
  const marker = /\b(?:thinking|planning|analyzing|researching|working|searched|stopped thinking)\b|(?:pensando|planejando|analisando|pesquisando|trabalhando|parou de pensar)/i;
  const selectors = [
    '[data-testid*="thinking"]',
    '[data-testid*="reasoning"]',
    '[data-testid*="activity"]',
    '[class*="thinking"]',
    '[class*="reasoning"]',
    '[aria-expanded]',
    '[aria-controls]',
    '[role="status"]',
    "details",
    "summary",
    "button",
    '[role="button"]',
  ].join(",");
  const values = [];
  for (const node of root.querySelectorAll(selectors)) {
    if (!visible(node)) continue;
    const label = `${normalizedText(node)} ${node.getAttribute("aria-label") || ""}`.trim();
    if (!label || label.length > 2_000 || !marker.test(label)) continue;
    const semantic = node.closest(
      '[data-testid*="thinking"], [data-testid*="reasoning"], [data-testid*="activity"], details',
    );
    const containerText = normalizedText(semantic || node);
    const value = (containerText.length <= 2_000 ? containerText : label).trim();
    if (!value || values.some((entry) => entry === value || entry.includes(value))) continue;
    values.push(value);
  }
  return values.slice(-12);
}

function extractVisibleReasoning(root, baseline = new Set()) {
  const expanded = extractExpandedReasoning(root);
  if (expanded) return expanded;
  return visibleReasoningEntries(root)
    .filter((value) => !baseline.has(value))
    .map((value) => value
      .replace(/\bSearched\s+\d+\s+websites?\b/gi, "")
      .replace(/\bPesquisou\s+\d+\s+sites?\b/gi, "")
      .trim())
    .filter((value) =>
      value
      && !/^(?:thinking|pensando|worked for\b.*|trabalhou por\b.*|stopped thinking|parou de pensar)$/i.test(value))
    .join("\n")
    .slice(0, 16_000);
}

function findReasoningToggle(root = document) {
  const pattern = /^(?:thinking|pensando|worked for\b|trabalhou por\b|stopped thinking\b|parou de pensar\b)/i;
  return [...root.querySelectorAll("button, [role='button']")]
    .filter((element) => visible(element) && pattern.test(normalizedText(element)))
    .at(-1) || null;
}

function extractExpandedReasoning(root) {
  if (!(root instanceof HTMLElement)) return "";
  const toggle = findReasoningToggle(root);
  const turn = toggle?.closest('[data-message-author-role="assistant"]');
  if (!(toggle instanceof HTMLElement) || !(turn instanceof HTMLElement)) return "";

  const toggleBottom = toggle.getBoundingClientRect().bottom;
  const searchPattern = /\bSearched\s+\d+\s+websites?\b|\bPesquisou\s+\d+\s+sites?\b/i;
  const searchTop = [...turn.querySelectorAll("button, [role='button'], div, span")]
    .filter((element) => visible(element) && searchPattern.test(normalizedText(element)))
    .map((element) => element.getBoundingClientRect().top)
    .filter((top) => top > toggleBottom + 2)
    .sort((a, b) => a - b)[0];
  const finalTop = searchTop ?? [...turn.querySelectorAll(".markdown, .prose")]
    .filter(visible)
    .map((element) => element.getBoundingClientRect().top)
    .filter((top) => top > toggleBottom + 2)
    .sort((a, b) => a - b)[0] ?? Number.POSITIVE_INFINITY;
  const values = [...turn.querySelectorAll("p")]
    .filter((element) => {
      if (!visible(element)) return false;
      const box = element.getBoundingClientRect();
      return box.top > toggleBottom + 2 && box.bottom < finalTop - 2;
    })
    .map(normalizedText)
    .filter((value) => value && value.length <= 8_000 && !searchPattern.test(value));
  return [...new Set(values)].join("\n").slice(0, 16_000);
}

function hasFinalResponseActions(root) {
  if (!(root instanceof HTMLElement)) return false;
  const selectors = [
    '[data-testid*="copy-turn"]',
    '[data-testid*="good-response"]',
    '[data-testid*="bad-response"]',
  ].join(",");
  return [...root.querySelectorAll(selectors)].some(visible);
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
  }) || null, 1_500).catch(() => null);
  if (!(link instanceof HTMLElement)) return;

  const currentTitle = normalizedText(link).replace(/\s*\[SKMAKE\]\s*$/i, "").trim();
  if (!currentTitle || /\[SKMAKE\]\s*$/i.test(normalizedText(link))) return;
  const container = link.closest("li") || link.parentElement?.parentElement || link.parentElement;
  if (!(container instanceof HTMLElement)) return;
  container.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

  const menuButton = await waitFor(() => [...container.querySelectorAll("button")].find((button) => {
    const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
    return /option|menu|more|opç|mais/i.test(label);
  }) || null, 1_000).catch(() => null);
  if (!(menuButton instanceof HTMLElement)) return;
  menuButton.click();

  const renameButton = await waitFor(() => [...document.querySelectorAll('button, [role="menuitem"]')].find((element) =>
    visible(element) && /\b(rename|renomear)\b/i.test(normalizedText(element))) || null, 1_000).catch(() => null);
  if (!(renameButton instanceof HTMLElement)) return;
  renameButton.click();

  const titleInput = await waitFor(() => {
    const candidates = [...document.querySelectorAll('input[type="text"], input:not([type])')].filter(visible);
    return candidates.find((input) => /rename|renomear|title|título/i.test(`${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""}`))
      || candidates.at(-1)
      || null;
  }, 1_000).catch(() => null);
  if (!(titleInput instanceof HTMLInputElement)) return;
  setNativeInputValue(titleInput, `${currentTitle} [SKMAKE]`);
  titleInput.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
  }));
}

function extractCodeText(pre) {
  const code = pre.querySelector("code") || pre;
  const raw = code.textContent || "";
  const rendered = code instanceof HTMLElement ? code.innerText : "";

  // The normal ChatGPT renderer keeps literal newlines in the code node.
  // Prefer that representation because it is unaffected by soft wrapping.
  if (raw.includes("\n")) return raw;
  if (rendered.includes("\n")) return rendered;

  // Some ChatGPT deployments render every source line as a positioned child
  // without placing newline characters in textContent/innerText. Reconstruct
  // those source lines from their vertical layout before relaying Markdown.
  let bestRows = [];
  for (const container of [code, ...code.querySelectorAll("*")]) {
    const children = [...container.children].filter((child) =>
      child instanceof HTMLElement && (child.textContent || "").length > 0);
    if (children.length < 2) continue;
    const rows = [];
    for (const child of children) {
      const rect = child.getBoundingClientRect();
      const top = Math.round(rect.top);
      const text = child.textContent || "";
      const row = rows.find((candidate) => Math.abs(candidate.top - top) <= 1);
      if (row) row.text += text;
      else rows.push({ top, text });
    }
    rows.sort((left, right) => left.top - right.top);
    if (rows.length > bestRows.length) bestRows = rows;
  }
  if (bestRows.length > 1) return bestRows.map((row) => row.text).join("\n");

  // Last structural fallback for line wrappers whose layout is unavailable
  // during a transient render. Avoid treating syntax-token spans as lines.
  const explicitLines = [...code.querySelectorAll(
    "[data-line], [data-line-number], [role='row'], .line",
  )].filter((line) =>
    !line.parentElement?.closest("[data-line], [data-line-number], [role='row'], .line"));
  if (explicitLines.length > 1) {
    return explicitLines.map((line) => line.textContent || "").join("\n");
  }

  return rendered || raw;
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
      const code = extractCodeText(node).replace(/\n+$/, "");
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

  const markdownRoots = [...root.querySelectorAll(".markdown, .prose")]
    .filter((candidate) => !candidate.parentElement?.closest(".markdown, .prose"));
  return normalize(markdownRoots.map((markdownRoot) => walk(markdownRoot)).join("\n\n"));
}

function hasUnstableCodeSnapshot(blocks, markdown) {
  const preCount = blocks.reduce(
    (total, block) => total + block.querySelectorAll("pre").length,
    0,
  );
  const looseCodeCount = blocks.reduce(
    (total, block) => total + [...block.querySelectorAll("code")]
      .filter((code) => !code.closest("pre")).length,
    0,
  );
  const malformedFence = /[^\n]```|```[^\n`]*```/.test(markdown);
  return malformedFence || (preCount === 0 && looseCodeCount >= 12);
}

async function monitorGeneration(
  requestId,
  submittedPrompt,
  submittedUser,
  assistantBaseline,
  timeoutMs,
  webBaseline,
  reasoningBaseline,
) {
  const deadline = Date.now() + Math.max(30_000, Number(timeoutMs || 480_000));
  let previous = "";
  let stopSeen = false;
  let stableChecks = 0;
  let idleChecks = 0;
  let lastChangeAt = Date.now();
  let threadReported = false;
  let previousWebSignature = "";
  let previousReasoning = "";
  let reasoningTranscript = "";
  let lastReasoningCheckAt = 0;
  const expandedReasoningToggles = new WeakSet();

  while (Date.now() < deadline && activeGeneration?.requestId === requestId) {
    if (!threadReported && /^https:\/\/chatgpt\.com\/c\/[a-z0-9-]+\/?$/i.test(location.href)) {
      generationEvent(requestId, "thread", { url: location.href });
      threadReported = true;
    }

    const stopVisible = visible(document.querySelector(STOP_SELECTOR));
    if (stopVisible) stopSeen = true;
    idleChecks = stopSeen && !stopVisible ? idleChecks + 1 : 0;

    const blocks = assistantBlocks();
    if (!submittedUser?.isConnected) {
      submittedUser = findSubmittedUser(submittedPrompt) || userBlocks().at(-1) || null;
    }
    const currentBlocks = submittedUser
      ? blocks.filter((block) => appearsAfter(submittedUser, block))
      : blocks.filter((block) => !assistantBaseline.has(block));
    const currentBlock = currentBlocks.at(-1) || null;
    const current = currentBlocks
      .map((block) => extractMarkdown(block))
      .filter(Boolean)
      .join("\n\n");
    const unstableCode = hasUnstableCodeSnapshot(currentBlocks, current);
    if (current && !unstableCode && current !== previous) {
      previous = current;
      stableChecks = 0;
      lastChangeAt = Date.now();
      generationEvent(requestId, "content", { content: current });
    } else if (current && !unstableCode) {
      stableChecks += 1;
    } else if (unstableCode) {
      stableChecks = 0;
      lastChangeAt = Date.now();
    }

    if (Date.now() - lastReasoningCheckAt >= 400) {
      lastReasoningCheckAt = Date.now();
      const reasoningToggle = findReasoningToggle(document);
      if (reasoningToggle && !expandedReasoningToggles.has(reasoningToggle)) {
        expandedReasoningToggles.add(reasoningToggle);
        if (reasoningToggle.getAttribute("aria-expanded") !== "true") {
          activateElement(reasoningToggle);
        }
      }
      const visibleReasoning = extractVisibleReasoning(document.body, reasoningBaseline);
      if (visibleReasoning && visibleReasoning !== previousReasoning) {
        previousReasoning = visibleReasoning;
        const transcriptWasOnlyStatus = /^(?:thinking|pensando|worked for\b.*|trabalhou por\b.*|stopped thinking|parou de pensar)$/i
          .test(reasoningTranscript.trim());
        if (!reasoningTranscript) reasoningTranscript = visibleReasoning;
        else if (transcriptWasOnlyStatus) reasoningTranscript = visibleReasoning;
        else if (visibleReasoning.startsWith(reasoningTranscript)) reasoningTranscript = visibleReasoning;
        else if (!reasoningTranscript.includes(visibleReasoning)) reasoningTranscript += `\n${visibleReasoning}`;
        lastChangeAt = Date.now();
        generationEvent(requestId, "reasoning", { content: reasoningTranscript });
      }
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

    const quietFor = Date.now() - lastChangeAt;
    const finalActions = hasFinalResponseActions(currentBlock);
    const hasOutput = Boolean(current || previousReasoning);
    const finished = !unstableCode && (stopSeen
      ? !stopVisible && hasOutput && (
        (finalActions && idleChecks >= 6 && quietFor >= 1_200)
        || (idleChecks >= 100 && quietFor >= 30_000)
      )
      : Boolean(current) && (
        (finalActions && stableChecks >= 12 && quietFor >= 2_000)
        || (stableChecks >= 100 && quietFor >= 30_000)
      ));
    if (finished) {
      await ensureSkmakeConversationTitle().catch(() => undefined);
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
  await ensureIdle();
  await switchModel(message.modelId);
  let input = await waitFor(findInput, 30_000, 100, "CHATGPT_INPUT_NOT_FOUND");
  const assistantBaseline = new Set(assistantBlocks());
  const userBaseline = new Set(userBlocks());
  const webBaseline = extractWebActivity(document.querySelector("main"));
  const reasoningBaseline = new Set(visibleReasoningEntries(document.body));
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

  const submitted = () => findSubmittedUser(message.prompt, userBaseline);

  let submittedUser;
  try {
    await attachFiles(message.attachments);
    await submit();
    submittedUser = await waitFor(submitted, 8_000, 120).catch(() => null);
    if (!submittedUser) {
      input = await waitFor(findInput, 5_000, 100, "CHATGPT_INPUT_NOT_FOUND");
      await submit();
      submittedUser = await waitFor(submitted, 8_000, 120).catch(() => null);
    }
    if (!submittedUser) throw new Error("CHATGPT_SUBMISSION_FAILED");
  } catch (error) {
    activeGeneration = null;
    throw error;
  }

  void monitorGeneration(
    message.requestId,
    message.prompt,
    submittedUser,
    assistantBaseline,
    message.timeoutMs,
    webBaseline,
    reasoningBaseline,
  );
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
          diagnostic: error instanceof Error && typeof error.diagnostic === "string"
            ? error.diagnostic
            : `model=${message.modelId}; visible=${visibleModelLabels().join("|")}`,
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

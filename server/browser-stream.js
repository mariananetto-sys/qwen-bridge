import crypto from "node:crypto";

const callbacks = new Map();
const initializedPages = new WeakSet();

async function ensureRelay(page) {
  if (initializedPages.has(page)) return;
  initializedPages.add(page);
  await page.exposeFunction("__skmakeStreamRelay", (requestId, type, data) => {
    const callback = callbacks.get(requestId);
    if (!callback) return;
    if (type === "meta") callback.meta(data);
    else if (type === "chunk") callback.chunk(data);
    else if (type === "end") callback.end();
    else if (type === "body") callback.body(data);
    else if (type === "error") callback.error(data);
  });
}

export async function browserJsonFetch(page, url, options = {}) {
  return page.evaluate(async ({ target, request }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs || 30_000);
    try {
      const response = await fetch(target, {
        method: request.method || "GET",
        headers: request.headers || {},
        body: request.body,
        signal: controller.signal,
      });
      const body = await response.text();
      return { status: response.status, statusText: response.statusText, contentType: response.headers.get("content-type") || "", body };
    } finally {
      clearTimeout(timeout);
    }
  }, { target: url, request: options });
}

export async function browserStreamFetch(page, url, options = {}) {
  await ensureRelay(page);
  const requestId = crypto.randomUUID();
  const encoder = new TextEncoder();
  let resolveMeta;
  let rejectMeta;
  const metaPromise = new Promise((resolve, reject) => {
    resolveMeta = resolve;
    rejectMeta = reject;
  });
  const timeoutMs = options.timeoutMs || 290_000;
  const metaTimeout = setTimeout(() => {
    callbacks.delete(requestId);
    rejectMeta(new Error("QWEN_STREAM_START_TIMEOUT"));
  }, Math.min(timeoutMs, 30_000));

  let cancelStream = () => {};
  const stream = new ReadableStream({
    start(controller) {
      callbacks.set(requestId, {
        meta(meta) {
          clearTimeout(metaTimeout);
          resolveMeta(meta);
        },
        chunk(value) {
          try { controller.enqueue(encoder.encode(value)); } catch { /* stream closed */ }
        },
        end() {
          try { controller.close(); } catch { /* stream closed */ }
          callbacks.delete(requestId);
        },
        body(value) {
          try {
            controller.error(new Error(`QWEN_NON_STREAM_RESPONSE:${String(value).slice(0, 500)}`));
          } catch { /* stream closed */ }
          callbacks.delete(requestId);
        },
        error(message) {
          clearTimeout(metaTimeout);
          const error = new Error(message || "QWEN_STREAM_FAILED");
          rejectMeta(error);
          try { controller.error(error); } catch { /* stream closed */ }
          callbacks.delete(requestId);
        },
      });

      void page.evaluate(async ({ target, request, relayId }) => {
        const controller = new AbortController();
        window.__skmakeAbortControllers ||= {};
        window.__skmakeAbortControllers[relayId] = controller;
        const timeout = setTimeout(() => controller.abort(), request.timeoutMs || 290_000);
        try {
          const response = await fetch(target, {
            method: request.method || "POST",
            headers: request.headers || {},
            body: request.body,
            signal: controller.signal,
          });
          const headers = {};
          response.headers.forEach((value, key) => { headers[key] = value; });
          window.__skmakeStreamRelay(relayId, "meta", {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get("content-type") || "",
            headers,
          });
          if (!response.ok || !response.body) {
            window.__skmakeStreamRelay(relayId, "body", await response.text());
            return;
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            window.__skmakeStreamRelay(relayId, "chunk", decoder.decode(value, { stream: true }));
          }
          window.__skmakeStreamRelay(relayId, "end", null);
        } catch (error) {
          window.__skmakeStreamRelay(relayId, "error", error instanceof Error ? error.message : "QWEN_STREAM_FAILED");
        } finally {
          clearTimeout(timeout);
          delete window.__skmakeAbortControllers[relayId];
        }
      }, { target: url, request: options, relayId: requestId }).catch((error) => {
        callbacks.get(requestId)?.error(error instanceof Error ? error.message : "QWEN_STREAM_FAILED");
      });

      cancelStream = () => {
        void page.evaluate((relayId) => {
          const controller = window.__skmakeAbortControllers?.[relayId];
          if (controller) controller.abort();
        }, requestId).catch(() => undefined);
        callbacks.delete(requestId);
        try { controller.close(); } catch { /* stream closed */ }
      };
    },
    cancel() {
      cancelStream();
    },
  });

  const meta = await metaPromise;
  if (meta.status >= 400 || !meta.contentType.includes("text/event-stream")) {
    cancelStream();
    throw new Error(`QWEN_UPSTREAM_${meta.status}`);
  }
  return { stream, cancel: cancelStream, ...meta };
}

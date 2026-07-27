function incrementalDelta(previous, incoming) {
  if (!incoming || incoming === "FINISHED" || incoming === previous) return { full: previous, delta: "" };
  if (!previous) return { full: incoming, delta: incoming };
  if (incoming.startsWith(previous)) return { full: incoming, delta: incoming.slice(previous.length) };
  return { full: previous + incoming, delta: incoming };
}

export class QwenSseParser {
  constructor() {
    this.buffer = "";
    this.responseId = null;
    this.content = "";
    this.reasoningIndex = 0;
  }

  push(value, flush = false) {
    this.buffer += value;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = flush ? "" : lines.pop() || "";
    const events = [];
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      const createdId = chunk["response.created"]?.response_id;
      if (createdId && !this.responseId) this.responseId = createdId;
      if (this.responseId && chunk.response_id && chunk.response_id !== this.responseId) continue;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.phase === "thinking_summary") {
        const thoughts = delta.extra?.summary_thought?.content;
        if (Array.isArray(thoughts) && thoughts.length > this.reasoningIndex) {
          const reasoning = thoughts.slice(this.reasoningIndex).join("\n");
          this.reasoningIndex = thoughts.length;
          if (reasoning) events.push({ reasoning });
        }
        continue;
      }
      if (delta.phase === "answer" && typeof delta.content === "string") {
        const next = incrementalDelta(this.content, delta.content);
        this.content = next.full;
        if (next.delta) events.push({ content: next.delta });
      }
    }
    return events;
  }
}

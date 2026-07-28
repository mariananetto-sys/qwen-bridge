export class ChatGptEventParser {
  constructor() {
    this.buffer = "";
  }

  push(value, flush = false) {
    this.buffer += value;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = flush ? "" : lines.pop() || "";
    const events = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event && typeof event === "object") events.push(event);
      } catch {
        // Extension relay events are private to this process. Invalid lines are ignored.
      }
    }
    return events;
  }
}

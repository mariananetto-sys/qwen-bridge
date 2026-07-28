import test from "node:test";
import assert from "node:assert/strict";
import { ChatGptEventParser } from "../server/chatgpt-events.js";
import { incrementalDelta, runtimeExtensionVersion } from "../server/chatgpt.js";

test("incrementalDelta emits only newly appended content", () => {
  assert.equal(incrementalDelta("", "Olá"), "Olá");
  assert.equal(incrementalDelta("Olá", "Olá, mundo"), ", mundo");
  assert.equal(incrementalDelta("Olá", "Olá"), "");
});

test("incrementalDelta ignores substantial rewrites to avoid duplicated output", () => {
  assert.equal(incrementalDelta("Resposta anterior", "Texto completamente diferente"), "");
});

test("incrementalDelta recovers when ChatGPT inserts a wrapper before streamed text", () => {
  assert.equal(
    incrementalDelta("Depend", "Atividade concluída\nDependências: Skript 2.7+"),
    "ências: Skript 2.7+",
  );
});

test("runtime extension versions increase with time and fit Chrome's format", () => {
  const earlier = runtimeExtensionVersion(new Date("2026-07-28T04:00:00.000Z"));
  const later = runtimeExtensionVersion(new Date("2026-07-28T04:00:04.000Z"));
  assert.match(earlier, /^\d{4}\.\d{1,3}\.\d{1,5}$/);
  assert.equal(earlier, "2026.209.7200");
  assert.equal(later, "2026.209.7202");
});

test("ChatGptEventParser accepts fragmented newline-delimited events", () => {
  const parser = new ChatGptEventParser();
  assert.deepEqual(parser.push('{"type":"content","del'), []);
  assert.deepEqual(parser.push('ta":"Oi"}\n{"type":"done"}\n'), [
    { type: "content", delta: "Oi" },
    { type: "done" },
  ]);
});

test("ChatGptEventParser preserves visible reasoning activity", () => {
  const parser = new ChatGptEventParser();
  assert.deepEqual(parser.push('{"type":"reasoning","delta":"Planning files"}\n', true), [
    { type: "reasoning", delta: "Planning files" },
  ]);
});

test("ChatGptEventParser ignores invalid private relay lines", () => {
  const parser = new ChatGptEventParser();
  assert.deepEqual(parser.push("not-json\n", true), []);
});

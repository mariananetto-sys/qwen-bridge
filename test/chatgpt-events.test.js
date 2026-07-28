import test from "node:test";
import assert from "node:assert/strict";
import { ChatGptEventParser } from "../server/chatgpt-events.js";
import { incrementalDelta } from "../server/chatgpt.js";

test("incrementalDelta emits only newly appended content", () => {
  assert.equal(incrementalDelta("", "Olá"), "Olá");
  assert.equal(incrementalDelta("Olá", "Olá, mundo"), ", mundo");
  assert.equal(incrementalDelta("Olá", "Olá"), "");
});

test("incrementalDelta ignores substantial rewrites to avoid duplicated output", () => {
  assert.equal(incrementalDelta("Resposta anterior", "Texto completamente diferente"), "");
});

test("ChatGptEventParser accepts fragmented newline-delimited events", () => {
  const parser = new ChatGptEventParser();
  assert.deepEqual(parser.push('{"type":"content","del'), []);
  assert.deepEqual(parser.push('ta":"Oi"}\n{"type":"done"}\n'), [
    { type: "content", delta: "Oi" },
    { type: "done" },
  ]);
});

test("ChatGptEventParser ignores invalid private relay lines", () => {
  const parser = new ChatGptEventParser();
  assert.deepEqual(parser.push("not-json\n", true), []);
});

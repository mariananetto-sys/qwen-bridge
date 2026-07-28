import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(testDirectory, "..", "extension", "manifest.json"), "utf8"),
);

test("Chrome extension is MV3 and scoped only to ChatGPT", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*"]);
  assert.deepEqual(manifest.permissions, ["tabs"]);
});

test("Chrome extension injects the bridge content script only on ChatGPT", () => {
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://chatgpt.com/*"]);
  assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
});

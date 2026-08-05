import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { canonicalVideoSceneSource } from "./videoSceneSourceHash.ts";

const scene = {
  title: "Café",
  narrationText: "A clear narration.",
  visualPrompt: "Show a sunrise",
  visualType: "image",
  durationMs: 1250,
  transition: "fade",
};

const digest = (value) => createHash("sha256").update(value).digest("hex");
const previousSceneSource = (value) => JSON.stringify([
  value.title, value.narrationText, value.visualPrompt,
  value.visualType, value.durationMs, value.transition,
]);
const postgresCanonicalEquivalent = (value) => {
  const field = (part) => `${Buffer.byteLength(String(part), "utf8")}:${part}`;
  return `v1|${field(value.title)}|${field(value.narrationText)}|${field(value.visualPrompt)}|${field(value.visualType)}|${field(value.durationMs)}|${field(value.transition)}`;
};

test("scene-source canonical form is stable and UTF-8 byte-length-prefixed", () => {
  const canonical = canonicalVideoSceneSource(scene);
  assert.equal(canonical, "v1|5:Café|18:A clear narration.|14:Show a sunrise|5:image|4:1250|4:fade");
  assert.equal(canonicalVideoSceneSource({ ...scene }), canonical);
  assert.equal(digest(canonicalVideoSceneSource({ ...scene })), digest(canonical));
});

test("every authoritative scene-source field changes the hash", () => {
  const expected = digest(canonicalVideoSceneSource(scene));
  for (const changed of [
    { title: "Cafe" }, { narrationText: "Different" }, { visualPrompt: "Different" },
    { visualType: "text" }, { durationMs: 1251 }, { transition: "cut" },
  ]) assert.notEqual(digest(canonicalVideoSceneSource({ ...scene, ...changed })), expected);
});

test("legacy JSON-array hashes differ and PostgreSQL v1 stays compatible for multibyte UTF-8", () => {
  const multibyte = {
    ...scene,
    title: "Café 🚀",
    narrationText: "नमस्ते 世界",
    visualPrompt: "Crème brûlée at 日出",
  };
  const canonical = canonicalVideoSceneSource(multibyte);
  assert.equal(canonical, postgresCanonicalEquivalent(multibyte));
  assert.notEqual(digest(previousSceneSource(multibyte)), digest(canonical));
});

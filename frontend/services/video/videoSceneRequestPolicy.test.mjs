import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
require("../../test-support/register-typescript.cjs");
const { parseVideoSceneRequest } = require("./videoSceneRequestPolicy.ts");
const { CREATOROS_MAX_VIDEO_DURATION_MS } = require("./videoDurationContract.ts");

const valid = { id: "11111111-1111-4111-8111-111111111111", sceneNumber: 1, title: "Scene", narrationText: "", visualPrompt: "Prompt", visualType: "title", startTimeMs: 0, durationMs: 250, transition: "cut", status: "planned" };

test("accepts a strictly shaped scene", () => assert.deepEqual(parseVideoSceneRequest([valid]), [valid]));
for (const [name, scene] of [
  ["unknown ownership field", { ...valid, user_id: "attacker" }],
  ["nested visual prompt", { ...valid, visualPrompt: { value: "Prompt" } }],
  ["unstable id", { ...valid, id: "scene-1" }],
  ["fractional scene number", { ...valid, sceneNumber: 1.5 }],
  ["unsupported visual type", { ...valid, visualType: "remote-url" }],
  ["unsupported transition", { ...valid, transition: "execute" }],
  ["invalid duration", { ...valid, durationMs: -1 }],
  ["non-finite start time", { ...valid, startTimeMs: Number.NaN }],
  ["oversized title", { ...valid, title: "x".repeat(201) }],
  ["oversized narration", { ...valid, narrationText: "x".repeat(1001) }],
  ["oversized visual prompt", { ...valid, visualPrompt: "x".repeat(2001) }],
  ["invalid status", { ...valid, status: "ready" }],
]) test(`rejects ${name}`, () => assert.throws(() => parseVideoSceneRequest([scene]), /scene|unsupported/i));

function durationScenes(durations) {
  let startTimeMs = 0;
  return durations.map((durationMs, index) => {
    const scene = {
      ...valid,
      id: `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
      sceneNumber: index + 1,
      startTimeMs,
      durationMs,
    };
    startTimeMs += durationMs;
    return scene;
  });
}

test("accepts exactly the 30-minute platform duration", () => {
  const scenes = durationScenes(Array.from({ length: 15 }, () => 120_000));
  assert.equal(scenes.reduce((total, scene) => total + scene.durationMs, 0), CREATOROS_MAX_VIDEO_DURATION_MS);
  assert.equal(parseVideoSceneRequest(scenes)?.length, 15);
});

test("rejects total scene duration above the 30-minute platform maximum", () => {
  const scenes = durationScenes([...Array.from({ length: 15 }, () => 120_000), 250]);
  assert.throws(() => parseVideoSceneRequest(scenes), /30-minute CreatorOS limit/);
});

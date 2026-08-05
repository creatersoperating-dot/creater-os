/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const test = require("node:test");

const { mockVideoProvider } = require("../providers/video/mockVideoProvider.server.ts");
const { validateMp4 } = require("./mp4Validation.server.ts");
const { buildDeterministicScenes } = require("./videoScenePlanning.server.ts");

function request(title, heartbeat) {
  return {
    projectId: "project-determinism-test",
    projectTitle: title,
    model: "mock-render-v1",
    scenes: [{
      id: "11111111-1111-4111-8111-111111111111",
      sceneNumber: 1,
      title,
      narrationText: "Deterministic local test.",
      visualPrompt: "A deterministic card",
      visualType: "title",
      durationMs: 250,
      transition: "cut",
    }],
    audio: { generationId: "audio-test", durationMs: 250, mimeType: "audio/wav", bytes: new Uint8Array([1, 2]) },
    heartbeat,
  };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function durationRequest(durations, heartbeat) {
  const base = request("Duration", heartbeat);
  return {
    ...base,
    scenes: durations.map((durationMs, index) => ({
      ...base.scenes[0],
      id: `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
      sceneNumber: index + 1,
      durationMs,
    })),
    audio: { ...base.audio, durationMs: durations.reduce((total, duration) => total + duration, 0) },
  };
}

test("mock visual preparation is separate and heartbeat-aware", async () => {
  let heartbeats = 0;
  const assets = await mockVideoProvider.generateVisualAssets(request("Assets", async () => { heartbeats += 1; }));
  assert.equal(heartbeats, 1);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].sceneId, "11111111-1111-4111-8111-111111111111");
  assert.equal(assets[0].mimeType, "image/svg+xml");
});

test("mock MP4 output is byte deterministic and remains valid", { timeout: 60_000 }, async () => {
  const first = await mockVideoProvider.render(request("Same input"));
  const second = await mockVideoProvider.render(request("Same input"));
  const different = await mockVideoProvider.render(request("Different input"));
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(digest(first.bytes), digest(second.bytes));
  assert.notEqual(digest(first.bytes), digest(different.bytes));
  assert.deepEqual(validateMp4(first.bytes), { width: 480, height: 270, durationMs: 250 });
});

test("mock rendering preserves abort behavior", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(mockVideoProvider.render({ ...request("Abort"), signal: controller.signal }), /cancelled/i);
});

test("mock duration limit is checked before visual work or frame allocation", async () => {
  assert.equal(mockVideoProvider.descriptor.capabilities.maximumDurationMs, 300_000);
  assert.equal(mockVideoProvider.descriptor.capabilities.maximumDurationMs * 4 / 1000, 1_200);
  let heartbeats = 0;
  const exact = await mockVideoProvider.generateVisualAssets(durationRequest([100_000, 100_000, 100_000], async () => { heartbeats += 1; }));
  assert.equal(exact.length, 3);
  assert.equal(heartbeats, 1);
  await assert.rejects(
    mockVideoProvider.generateVisualAssets(durationRequest([120_000, 120_000, 60_001], async () => { heartbeats += 1; })),
    /up to five minutes/,
  );
  assert.equal(heartbeats, 1);
});

test("30-minute deterministic planning stays within bounded scene allocation", () => {
  const scenes = buildDeterministicScenes({ title: "Long-form", content: "A concise source." }, 1_800_000);
  assert.equal(scenes.length, 15);
  assert.equal(scenes.reduce((total, scene) => total + scene.durationMs, 0), 1_800_000);
  assert.equal(Math.max(...scenes.map((scene) => scene.durationMs)), 120_000);
});

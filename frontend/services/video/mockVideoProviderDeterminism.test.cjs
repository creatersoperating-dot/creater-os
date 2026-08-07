/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const test = require("node:test");

const { mockVideoRenderer, mockVisualAssetProvider } = require("../providers/video/mockVideoProvider.server.ts");
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

async function renderRequest(title, heartbeat) {
  const base = request(title, heartbeat);
  const visualAssets = await mockVisualAssetProvider.generateVisualAssets({
    projectId: base.projectId, projectTitle: base.projectTitle, model: "mock-visual-v1",
    scenes: base.scenes, heartbeat,
  });
  return { ...base, visualAssets };
}

function topLevelBoxes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  for (let offset = 0; offset < bytes.byteLength;) {
    const size = view.getUint32(offset);
    boxes.push({ type: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)), bytes: bytes.slice(offset, offset + size) });
    offset += size;
  }
  return boxes;
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
  const base = request("Assets", async () => { heartbeats += 1; });
  const assets = await mockVisualAssetProvider.generateVisualAssets({ ...base, model: "mock-visual-v1" });
  assert.equal(heartbeats, 1);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].sceneId, "11111111-1111-4111-8111-111111111111");
  assert.equal(assets[0].mimeType, "image/svg+xml");
});

test("mock MP4 output is byte deterministic and remains valid", { timeout: 60_000 }, async () => {
  const first = await mockVideoRenderer.render(await renderRequest("Same input"));
  const second = await mockVideoRenderer.render(await renderRequest("Same input"));
  const different = await mockVideoRenderer.render(await renderRequest("Different input"));
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(digest(first.bytes), digest(second.bytes));
  assert.notEqual(digest(first.bytes), digest(different.bytes));
  assert.deepEqual(validateMp4(first.bytes), { width: 480, height: 270, durationMs: 250, hasAudio: false, fastStart: false });
});

test("structural validation identifies fast-start ordering and rejects an invalid ftyp", { timeout: 60_000 }, async () => {
  const rendered = await mockVideoRenderer.render(await renderRequest("Fast start structure"));
  const boxes = topLevelBoxes(rendered.bytes);
  const ordered = [...boxes.filter((box) => box.type === "ftyp"), ...boxes.filter((box) => box.type === "moov"),
    ...boxes.filter((box) => box.type !== "ftyp" && box.type !== "moov")];
  const fastStart = Buffer.concat(ordered.map((box) => Buffer.from(box.bytes)));
  assert.equal(validateMp4(fastStart).fastStart, true);

  const invalidFtyp = rendered.bytes.slice();
  const ftyp = boxes[0];
  invalidFtyp.fill("z".charCodeAt(0), 8, ftyp.bytes.byteLength);
  assert.throws(() => validateMp4(invalidFtyp), /unsupported MP4 file type/);
});

test("mock rendering preserves abort behavior", async () => {
  const controller = new AbortController();
  const render = await renderRequest("Abort");
  controller.abort();
  await assert.rejects(mockVideoRenderer.render({ ...render, signal: controller.signal }), /cancelled/i);
});

test("mock duration limit is checked before visual work or frame allocation", async () => {
  assert.equal(mockVideoRenderer.descriptor.capabilities.maximumDurationMs, 300_000);
  assert.equal(mockVideoRenderer.descriptor.capabilities.maximumDurationMs * 4 / 1000, 1_200);
  let heartbeats = 0;
  const exactRequest = durationRequest([100_000, 100_000, 100_000], async () => { heartbeats += 1; });
  const exact = await mockVisualAssetProvider.generateVisualAssets({ ...exactRequest, model: "mock-visual-v1" });
  assert.equal(exact.length, 3);
  assert.equal(heartbeats, 1);
  const tooLong = durationRequest([120_000, 120_000, 60_001], async () => { heartbeats += 1; });
  const tooLongAssets = await mockVisualAssetProvider.generateVisualAssets({ ...tooLong, model: "mock-visual-v1" });
  await assert.rejects(
    mockVideoRenderer.render({ ...tooLong, visualAssets: tooLongAssets }),
    /up to five minutes/,
  );
  assert.equal(heartbeats, 2);
});

test("30-minute deterministic planning stays within bounded scene allocation", () => {
  const scenes = buildDeterministicScenes({ title: "Long-form", content: "A concise source." }, 1_800_000);
  assert.equal(scenes.length, 15);
  assert.equal(scenes.reduce((total, scene) => total + scene.durationMs, 0), 1_800_000);
  assert.equal(Math.max(...scenes.map((scene) => scene.durationMs)), 120_000);
});

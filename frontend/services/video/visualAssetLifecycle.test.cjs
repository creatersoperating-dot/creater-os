/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { cleanupPartialVisualAssetUploads, reuseOrGenerateVisualAssets } = require("./visualAssetLifecycle.server.ts");

test("a complete authoritative asset set is reused without another provider call", async () => {
  const reusable = [{ sceneId: "scene-1", sceneNumber: 1, bytes: new Uint8Array([1]), format: "png",
    mimeType: "image/png", width: 1280, height: 720, contentSha256: "a".repeat(64) }];
  let generated = 0;
  const result = await reuseOrGenerateVisualAssets(async () => reusable, async () => { generated += 1; return []; });
  assert.strictEqual(result, reusable);
  assert.equal(generated, 0);
});

test("provider generation runs only when no complete reusable set exists", async () => {
  const generatedAssets = [{ sceneId: "scene-1" }];
  let generated = 0;
  const result = await reuseOrGenerateVisualAssets(async () => null, async () => { generated += 1; return generatedAssets; });
  assert.strictEqual(result, generatedAssets);
  assert.equal(generated, 1);
});

test("partial-upload cleanup removes every path and preserves cleanup-pending per failure", async () => {
  const removed = [];
  const marked = [];
  await cleanupPartialVisualAssetUploads([
    { id: "asset-1", path: "trusted/1.png" },
    { id: "asset-2", path: "trusted/2.png" },
  ], async (path) => {
    removed.push(path);
    if (path.endsWith("2.png")) throw new Error("storage unavailable");
  }, async (id, cleanupPending) => { marked.push({ id, cleanupPending }); });
  assert.deepEqual(removed, ["trusted/1.png", "trusted/2.png"]);
  assert.deepEqual(marked, [
    { id: "asset-1", cleanupPending: false },
    { id: "asset-2", cleanupPending: true },
  ]);
});

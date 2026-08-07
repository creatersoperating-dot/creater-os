/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { getVisualProviderConfiguration } = require("./visualProviderConfig.server.ts");
const { getConfiguredVisualAssetProvider } = require("./visualProviderRegistry.server.ts");
const { getConfiguredVideoRenderer } = require("./videoProviderRegistry.server.ts");

const keys = [
  "NODE_ENV", "GOOGLE_GENERATIVE_AI_API_KEY", "CREATOROS_VISUAL_PROVIDER", "CREATOROS_VISUAL_MODEL",
  "CREATOROS_VISUAL_FALLBACK_PROVIDER", "CREATOROS_VISUAL_REQUEST_TIMEOUT_MS", "CREATOROS_VISUAL_MAX_CONCURRENCY",
  "CREATOROS_VIDEO_PROVIDER", "CREATOROS_VIDEO_MODEL", "CREATOROS_VIDEO_FALLBACK_PROVIDER",
  "CREATOROS_VIDEO_REQUEST_TIMEOUT_MS", "CREATOROS_VIDEO_ACTIVE_LEASE_MS", "CREATOROS_VIDEO_HEARTBEAT_MS",
];

async function configured(overrides, action) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: "test",
    CREATOROS_VISUAL_PROVIDER: "disabled",
    CREATOROS_VISUAL_MODEL: "disabled",
    CREATOROS_VISUAL_FALLBACK_PROVIDER: "none",
    CREATOROS_VISUAL_REQUEST_TIMEOUT_MS: "120000",
    CREATOROS_VISUAL_MAX_CONCURRENCY: "2",
    CREATOROS_VIDEO_PROVIDER: "disabled",
    CREATOROS_VIDEO_MODEL: "disabled",
    CREATOROS_VIDEO_FALLBACK_PROVIDER: "none",
    CREATOROS_VIDEO_REQUEST_TIMEOUT_MS: "240000",
    CREATOROS_VIDEO_ACTIVE_LEASE_MS: "30000",
    CREATOROS_VIDEO_HEARTBEAT_MS: "5000",
    ...overrides,
  });
  try { return await action(); }
  finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("Gemini visual configuration is explicit, bounded, and has no fallback", async () => {
  await configured({
    CREATOROS_VISUAL_PROVIDER: "gemini",
    CREATOROS_VISUAL_MODEL: "gemini-3.1-flash-image",
    GOOGLE_GENERATIVE_AI_API_KEY: "test-key-never-used",
    CREATOROS_VISUAL_REQUEST_TIMEOUT_MS: "90000",
    CREATOROS_VISUAL_MAX_CONCURRENCY: "3",
  }, async () => {
    const config = getVisualProviderConfiguration();
    assert.equal(config.provider, "gemini");
    assert.equal(config.model, "gemini-3.1-flash-image");
    assert.equal(config.timeoutMs, 90_000);
    assert.equal(config.maxConcurrency, 3);
    assert.equal(config.fallbackProvider, "none");
    const selected = await getConfiguredVisualAssetProvider();
    assert.equal(selected.adapter.descriptor.id, "gemini");
    assert.deepEqual(selected.adapter.descriptor.capabilities.formats, ["png"]);
  });
});

test("missing Gemini key is sanitized and nonretryable", async () => {
  await configured({ CREATOROS_VISUAL_PROVIDER: "gemini", CREATOROS_VISUAL_MODEL: "gemini-3.1-flash-image" }, async () => {
    assert.throws(getVisualProviderConfiguration, (error) => {
      assert.equal(error.code, "configuration_invalid");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, /key|GOOGLE|environment/i);
      return true;
    });
  });
});

test("unsupported visual provider, model, fallback, timeout, and concurrency fail closed", async () => {
  await configured({ CREATOROS_VISUAL_PROVIDER: "other" }, async () => assert.throws(getVisualProviderConfiguration, /unsupported/));
  await configured({ CREATOROS_VISUAL_PROVIDER: "gemini", CREATOROS_VISUAL_MODEL: "other", GOOGLE_GENERATIVE_AI_API_KEY: "secret" },
    async () => assert.throws(getVisualProviderConfiguration, /model is unsupported/));
  await configured({ CREATOROS_VISUAL_FALLBACK_PROVIDER: "mock" }, async () => assert.throws(getVisualProviderConfiguration, /fallback is disabled/));
  await configured({ CREATOROS_VISUAL_REQUEST_TIMEOUT_MS: "9999" }, async () => assert.throws(getVisualProviderConfiguration, /REQUEST_TIMEOUT_MS/));
  await configured({ CREATOROS_VISUAL_MAX_CONCURRENCY: "5" }, async () => assert.throws(getVisualProviderConfiguration, /MAX_CONCURRENCY/));
});

test("mock visual generation is forbidden in production", async () => {
  await configured({ NODE_ENV: "production", CREATOROS_VISUAL_PROVIDER: "mock", CREATOROS_VISUAL_MODEL: "mock-visual-v1" },
    async () => assert.throws(getVisualProviderConfiguration, /unavailable in production/));
});

test("visual and renderer registries select independently", async () => {
  await configured({
    CREATOROS_VISUAL_PROVIDER: "mock", CREATOROS_VISUAL_MODEL: "mock-visual-v1",
    CREATOROS_VIDEO_PROVIDER: "mock", CREATOROS_VIDEO_MODEL: "mock-render-v1",
  }, async () => {
    const [visual, renderer] = await Promise.all([
      getConfiguredVisualAssetProvider(), getConfiguredVideoRenderer(),
    ]);
    assert.equal(visual.adapter.descriptor.id, "mock");
    assert.equal(visual.model, "mock-visual-v1");
    assert.equal(renderer.adapter.descriptor.id, "mock");
    assert.equal(renderer.model, "mock-render-v1");
    assert.equal(typeof renderer.adapter.generateVisualAssets, "undefined");
    assert.equal(typeof visual.adapter.render, "undefined");
  });
});

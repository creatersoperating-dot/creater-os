/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { preflightMediaCapabilities, clearMediaCapabilityPreflightCacheForTests } = require("../providers/video/mediaCapabilityPreflight.server.ts");
const { getVideoProviderConfiguration } = require("../providers/video/videoProviderConfig.server.ts");
const { getConfiguredVideoProvider } = require("../providers/video/videoProviderRegistry.server.ts");
const { VideoProviderError } = require("../providers/video/videoProviderTypes.ts");
const { videoApiError } = require("./videoApiResponse.server.ts");

const keys = ["NODE_ENV", "CREATOROS_VIDEO_PROVIDER", "CREATOROS_VIDEO_MODEL", "CREATOROS_VIDEO_FALLBACK_PROVIDER",
  "CREATOROS_VIDEO_REQUEST_TIMEOUT_MS", "CREATOROS_VIDEO_ACTIVE_LEASE_MS", "CREATOROS_VIDEO_HEARTBEAT_MS",
  "CREATOROS_FFMPEG_PATH", "CREATOROS_FFPROBE_PATH"];

async function configured(overrides, action) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: "test", CREATOROS_VIDEO_PROVIDER: "disabled", CREATOROS_VIDEO_MODEL: "disabled",
    CREATOROS_VIDEO_FALLBACK_PROVIDER: "none", CREATOROS_VIDEO_REQUEST_TIMEOUT_MS: "240000",
    CREATOROS_VIDEO_ACTIVE_LEASE_MS: "30000", CREATOROS_VIDEO_HEARTBEAT_MS: "5000",
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

async function mapped(action) {
  try { await action(); throw new Error("Expected action to fail"); }
  catch (error) {
    const response = videoApiError(error);
    return { status: response.status, body: await response.json() };
  }
}

test("provider-disabled and invalid executable configuration retain sanitized nonretryable errors", async () => {
  const disabled = await configured({}, () => mapped(getConfiguredVideoProvider));
  assert.deepEqual(disabled, { status: 503, body: { error: { code: "provider_disabled", message: "Video rendering is not configured.", retryable: false } } });

  const base = { CREATOROS_VIDEO_PROVIDER: "ffmpeg", CREATOROS_VIDEO_MODEL: "ffmpeg-h264-aac-v1" };
  const missingFfmpeg = await configured(base, () => mapped(getVideoProviderConfiguration));
  assert.equal(missingFfmpeg.status, 503); assert.equal(missingFfmpeg.body.error.code, "configuration_invalid"); assert.equal(missingFfmpeg.body.error.retryable, false);
  const missingProbe = await configured({ ...base, CREATOROS_FFMPEG_PATH: "C:\\tools\\ffmpeg.exe" }, () => mapped(getVideoProviderConfiguration));
  assert.equal(missingProbe.status, 503); assert.equal(missingProbe.body.error.code, "configuration_invalid");
  const relative = await configured({ ...base, CREATOROS_FFMPEG_PATH: "C:\\tools\\ffmpeg.exe", CREATOROS_FFPROBE_PATH: "ffprobe.exe" }, () => mapped(getVideoProviderConfiguration));
  assert.equal(relative.status, 503); assert.doesNotMatch(relative.body.error.message, /C:\\|tools/i);
});

test("unsupported model/provider map to 422 without becoming retryable", async () => {
  const model = await configured({ CREATOROS_VIDEO_PROVIDER: "ffmpeg", CREATOROS_VIDEO_MODEL: "ffmpeg-other" }, () => mapped(getVideoProviderConfiguration));
  assert.equal(model.status, 422); assert.equal(model.body.error.code, "model_unavailable"); assert.equal(model.body.error.retryable, false);
  const provider = await configured({ CREATOROS_VIDEO_PROVIDER: "other" }, () => mapped(getVideoProviderConfiguration));
  assert.equal(provider.status, 422); assert.equal(provider.body.error.code, "provider_unsupported"); assert.equal(provider.body.error.retryable, false);
});

test("missing encoder capability reaches the API envelope as a nonretryable configuration error", async () => {
  clearMediaCapabilityPreflightCacheForTests();
  const empty = { stderr: new Uint8Array(), stdoutTruncated: false, stderrTruncated: false };
  const result = await mapped(() => preflightMediaCapabilities({
    ffmpegPath: "C:\\private\\ffmpeg.exe", ffprobePath: "C:\\private\\ffprobe.exe",
    model: "ffmpeg-h264-aac-v1", timeoutMs: 5_000,
    runProcess: async () => ({ ...empty, stdout: new TextEncoder().encode(" A..... aac AAC") }),
  }));
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "configuration_invalid");
  assert.equal(result.body.error.retryable, false);
  assert.doesNotMatch(result.body.error.message, /private|ffmpeg\.exe/);
});

test("timeout and cancellation retain their retry flags while unknown errors stay generic", async () => {
  const timeout = await mapped(async () => { throw new VideoProviderError("timeout", "Video generation timed out.", true); });
  assert.deepEqual(timeout, { status: 504, body: { error: { code: "timeout", message: "Video generation timed out.", retryable: true } } });
  const cancellation = await mapped(async () => { throw new VideoProviderError("cancelled", "Video rendering was cancelled.", true); });
  assert.equal(cancellation.status, 408); assert.equal(cancellation.body.error.retryable, true);
  const unknown = await mapped(async () => { throw new Error("C:\\private\\unexpected detail"); });
  assert.deepEqual(unknown, { status: 500, body: { error: { code: "internal_error", message: "Video production failed.", retryable: true } } });
});

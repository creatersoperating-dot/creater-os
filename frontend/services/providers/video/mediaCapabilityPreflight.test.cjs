/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clearMediaCapabilityPreflightCacheForTests,
  preflightMediaCapabilities,
} = require("./mediaCapabilityPreflight.server.ts");

const empty = { stdout: new Uint8Array(), stderr: new Uint8Array(), stdoutTruncated: false, stderrTruncated: false };

test("preflight verifies libx264, AAC, and ffprobe once per executable pair", async () => {
  clearMediaCapabilityPreflightCacheForTests();
  const calls = [];
  const runProcess = async (request) => {
    calls.push(request);
    if (request.args.includes("-encoders")) return { ...empty, stdout: new TextEncoder().encode(" V..... libx264 H.264\n A..... aac AAC") };
    return empty;
  };
  const request = { ffmpegPath: "C:\\tools\\ffmpeg.exe", ffprobePath: "C:\\tools\\ffprobe.exe", model: "ffmpeg-h264-aac-v1", timeoutMs: 5_000, runProcess };
  await preflightMediaCapabilities(request);
  await preflightMediaCapabilities(request);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].captureStdout, true);
  assert.deepEqual(calls[1].args, ["-v", "error", "-version"]);
});

test("missing encoder capability is sanitized and nonretryable", async () => {
  clearMediaCapabilityPreflightCacheForTests();
  await assert.rejects(preflightMediaCapabilities({
    ffmpegPath: "C:\\private\\ffmpeg.exe", ffprobePath: "C:\\private\\ffprobe.exe", model: "ffmpeg-h264-aac-v1", timeoutMs: 5_000,
    runProcess: async () => ({ ...empty, stdout: new TextEncoder().encode(" A..... aac AAC") }),
  }), (error) => {
    assert.equal(error.code, "configuration_invalid");
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /private|ffmpeg\.exe/);
    return true;
  });
});

test("identical concurrent cold preflights share one FFmpeg check and one ffprobe check", async () => {
  clearMediaCapabilityPreflightCacheForTests();
  let calls = 0;
  const runProcess = async (request) => {
    calls += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return request.args.includes("-encoders")
      ? { ...empty, stdout: new TextEncoder().encode(" V..... libx264 H.264\n A..... aac AAC") }
      : empty;
  };
  const request = { ffmpegPath: "C:\\concurrent\\ffmpeg.exe", ffprobePath: "C:\\concurrent\\ffprobe.exe", model: "ffmpeg-h264-aac-v1", timeoutMs: 5_000, runProcess };
  await Promise.all([preflightMediaCapabilities(request), preflightMediaCapabilities(request)]);
  assert.equal(calls, 2);
});

test("a rejected preflight is evicted so a corrected installation retries", async () => {
  clearMediaCapabilityPreflightCacheForTests();
  let calls = 0;
  const runProcess = async (request) => {
    calls += 1;
    if (request.args.includes("-encoders")) {
      return { ...empty, stdout: new TextEncoder().encode(calls === 1 ? " A..... aac AAC" : " V..... libx264 H.264\n A..... aac AAC") };
    }
    return empty;
  };
  const request = { ffmpegPath: "C:\\retry\\ffmpeg.exe", ffprobePath: "C:\\retry\\ffprobe.exe", model: "ffmpeg-h264-aac-v1", timeoutMs: 5_000, runProcess };
  await assert.rejects(preflightMediaCapabilities(request), /must provide/);
  await preflightMediaCapabilities(request);
  assert.equal(calls, 3);
});

test("different executable or model configuration does not share cached preflight", async () => {
  clearMediaCapabilityPreflightCacheForTests();
  let calls = 0;
  const runProcess = async (request) => {
    calls += 1;
    return request.args.includes("-encoders")
      ? { ...empty, stdout: new TextEncoder().encode(" V..... libx264 H.264\n A..... aac AAC") }
      : empty;
  };
  const base = { ffmpegPath: "C:\\a\\ffmpeg.exe", ffprobePath: "C:\\a\\ffprobe.exe", model: "ffmpeg-h264-aac-v1", timeoutMs: 5_000, runProcess };
  await preflightMediaCapabilities(base);
  await preflightMediaCapabilities({ ...base, ffprobePath: "C:\\b\\ffprobe.exe" });
  await preflightMediaCapabilities({ ...base, model: "another-model" });
  assert.equal(calls, 6);
});

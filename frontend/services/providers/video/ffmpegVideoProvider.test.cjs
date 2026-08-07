/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { access, readFile, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const { assemblePcmChunksToWav } = require("../../audio/wavAssembly.server.ts");
const {
  buildFfmpegArguments,
  createFfmpegVideoProvider,
  extendFinalSceneForNarration,
} = require("./ffmpegVideoProvider.server.ts");
const { VideoProviderError } = require("./videoProviderTypes.ts");
const { ProcessTerminationUnconfirmedError } = require("./mediaProcess.server.ts");
const { deferredMediaCleanupCountForTests } = require("./deferredMediaCleanup.server.ts");

const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>');
const processResult = { stdout: new Uint8Array(), stderr: new Uint8Array(), stdoutTruncated: false, stderrTruncated: false };

function wav(milliseconds) {
  return assemblePcmChunksToWav([new Uint8Array(48 * milliseconds)]);
}

function metadata(durationMs) {
  return { width: 1280, height: 720, durationMs, hasAudio: true, fastStart: true };
}

function probeMetadata(durationMs) {
  return { width: 1280, height: 720, durationMs, hasAudio: true, audioSampleRate: 48_000 };
}

function request(overrides = {}, audioDurationMs = 1_250) {
  const scenes = [
    { id: "scene-a", sceneNumber: 1, title: "A", narrationText: "First", visualPrompt: "First", visualType: "title", durationMs: 500, transition: "cut" },
    { id: "scene-b", sceneNumber: 2, title: "B", narrationText: "Second", visualPrompt: "Second", visualType: "image", durationMs: 750, transition: "fade" },
  ];
  const audio = wav(audioDurationMs);
  return {
    projectId: "project-test",
    projectTitle: "Provider test",
    model: "ffmpeg-h264-aac-v1",
    scenes,
    audio: { generationId: "audio-test", durationMs: audio.durationMs, mimeType: "audio/wav", bytes: audio.wavBytes },
    visualAssets: scenes.map((scene) => ({
      sceneId: scene.id, sceneNumber: scene.sceneNumber, bytes: svg,
      format: "svg", mimeType: "image/svg+xml", width: 16, height: 16,
    })),
    ...overrides,
  };
}

function providerOptions(durationMs, overrides = {}) {
  return {
    executablePath: process.execPath,
    ffprobePath: process.execPath,
    timeoutMs: 45_000,
    preflight: async () => {},
    inspectOutput: () => metadata(durationMs),
    probeOutput: async () => probeMetadata(durationMs),
    ...overrides,
  };
}

test("ffmpeg arguments select browser-compatible H.264/AAC fast-start output without shell syntax", () => {
  const args = buildFfmpegArguments(1_250);
  assert.deepEqual(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2), ["-c:v", "libx264"]);
  assert.deepEqual(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 2), ["-c:a", "aac"]);
  assert.ok(args.includes("yuv420p"));
  assert.ok(args.includes("+faststart"));
  assert.ok(args.every((argument) => !/[;&|]/.test(argument)));
});

test("render passes exact WAV bytes and returns structural plus probed metadata", async () => {
  let processRequest;
  let narrationBytes;
  const provider = createFfmpegVideoProvider(providerOptions(1_250, {
    runProcess: async (received) => {
      processRequest = received;
      narrationBytes = new Uint8Array(await readFile(path.join(received.cwd, "narration.wav")));
      await writeFile(path.join(received.cwd, "render.mp4"), new Uint8Array([1, 2, 3]));
      return processResult;
    },
  }));
  const renderRequest = request();
  const result = await provider.render(renderRequest);
  assert.equal(processRequest.executablePath, process.execPath);
  assert.equal(processRequest.timeoutMs, 45_000);
  assert.deepEqual(narrationBytes, renderRequest.audio.bytes);
  assert.equal(result.hasAudio, true);
  assert.equal(result.durationMs, 1_250);
});

test("longer narration extends only the final in-memory visual and is never truncated", async () => {
  const renderRequest = request({}, 1_500);
  const originalScenes = structuredClone(renderRequest.scenes);
  let timeline;
  let args;
  const provider = createFfmpegVideoProvider(providerOptions(1_500, {
    runProcess: async (received) => {
      args = received.args;
      timeline = await readFile(path.join(received.cwd, "timeline.ffconcat"), "utf8");
      await writeFile(path.join(received.cwd, "render.mp4"), new Uint8Array([1]));
      return processResult;
    },
  }));
  await provider.render(renderRequest);
  assert.deepEqual(renderRequest.scenes, originalScenes);
  assert.match(timeline, /duration 0\.500000[\s\S]*duration 1\.000000/);
  assert.equal(args[args.indexOf("-t") + 1], "1.500000");
});

test("shorter narration preserves the original scene timeline and pads audio", () => {
  const renderRequest = request({}, 1_000);
  const timeline = extendFinalSceneForNarration(renderRequest.scenes, 1_000);
  assert.equal(timeline.durationMs, 1_250);
  assert.strictEqual(timeline.scenes, renderRequest.scenes);
  const args = buildFfmpegArguments(timeline.durationMs);
  assert.equal(args[args.indexOf("-t") + 1], "1.250000");
  assert.ok(args.includes("apad=whole_dur=1.250000"));
});

test("non-millisecond PCM duration rounds the output boundary upward", async () => {
  const assembled = assemblePcmChunksToWav([new Uint8Array(2_401 * 2)]);
  const base = request();
  const scene = { ...base.scenes[0], durationMs: 100 };
  let args;
  const provider = createFfmpegVideoProvider(providerOptions(101, {
    runProcess: async (received) => {
      args = received.args;
      await writeFile(path.join(received.cwd, "render.mp4"), new Uint8Array([1]));
      return processResult;
    },
  }));
  await provider.render({
    ...base,
    scenes: [scene],
    visualAssets: [{ ...base.visualAssets[0], sceneId: scene.id, sceneNumber: 1 }],
    audio: { generationId: "audio-fractional", durationMs: assembled.durationMs, mimeType: "audio/wav", bytes: assembled.wavBytes },
  });
  assert.equal(args[args.indexOf("-t") + 1], "0.101000");
  assert.ok(101 >= 2_401 * 1_000 / 24_000);
});

test("malformed or duration-mismatched WAV is nonretryable and rejected before spawn", async () => {
  let executed = false;
  const provider = createFfmpegVideoProvider(providerOptions(1_250, {
    runProcess: async () => { executed = true; return processResult; },
  }));
  const malformed = request({ audio: { generationId: "audio", durationMs: 1_250, mimeType: "audio/wav", bytes: new Uint8Array([82, 73, 70, 70]) } });
  await assert.rejects(provider.render(malformed), (error) => error.code === "invalid_audio" && error.retryable === false);
  const mismatched = request();
  mismatched.audio.durationMs += 10;
  await assert.rejects(provider.render(mismatched), (error) => error.code === "invalid_audio" && error.retryable === false);
  assert.equal(executed, false);
});

test("out-of-order or corrupt authoritative visuals fail deterministically before process execution", async () => {
  let executed = false;
  const provider = createFfmpegVideoProvider(providerOptions(1_250, {
    runProcess: async () => { executed = true; return processResult; },
  }));
  const renderRequest = request();
  await assert.rejects(provider.render({ ...renderRequest, visualAssets: [...renderRequest.visualAssets].reverse() }),
    (error) => error.code === "invalid_asset_set" && error.retryable === false);
  const corrupt = request();
  corrupt.visualAssets[0].bytes = new Uint8Array([1, 2, 3]);
  await assert.rejects(provider.render(corrupt), (error) => error.code === "invalid_asset" && error.retryable === false);
  assert.equal(executed, false);
});

test("normalized PNG authoritative visuals remain compatible with FFmpeg frame preparation", async () => {
  const png = new Uint8Array(await sharp({ create: {
    width: 1280, height: 720, channels: 3, background: { r: 12, g: 34, b: 56 },
  } }).png().toBuffer());
  let prepared;
  const provider = createFfmpegVideoProvider(providerOptions(1_250, {
    runProcess: async (received) => {
      prepared = await sharp(path.join(received.cwd, "scene-0001.png")).metadata();
      await writeFile(path.join(received.cwd, "render.mp4"), new Uint8Array([1]));
      return processResult;
    },
  }));
  const renderRequest = request();
  renderRequest.visualAssets = renderRequest.scenes.map((scene) => ({
    sceneId: scene.id, sceneNumber: scene.sceneNumber, bytes: png,
    format: "png", mimeType: "image/png", width: 1280, height: 720,
  }));
  await provider.render(renderRequest);
  assert.equal(prepared.format, "png");
  assert.equal(prepared.width, 1280);
  assert.equal(prepared.height, 720);
});

test("temporary files are removed after success and cleanup failure overrides success", async () => {
  let successDirectory;
  const successful = createFfmpegVideoProvider(providerOptions(1_250, {
    runProcess: async (received) => {
      successDirectory = received.cwd;
      await writeFile(path.join(received.cwd, "render.mp4"), new Uint8Array([1]));
      return processResult;
    },
  }));
  await successful.render(request());
  await assert.rejects(access(successDirectory));

  let attempts = 0;
  const cleanupFailure = createFfmpegVideoProvider(providerOptions(1_250, {
    cleanupRetryDelaysMs: [0, 0, 0],
    removeTemporaryDirectory: async () => { attempts += 1; throw new Error("private temp path"); },
    runProcess: async (received) => {
      await writeFile(path.join(received.cwd, "render.mp4"), new Uint8Array([1]));
      return processResult;
    },
  }));
  await assert.rejects(cleanupFailure.render(request()), (error) => {
    assert.equal(error.code, "cleanup_failed");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /private|temp path/i);
    return true;
  });
  assert.equal(attempts, 3);
});

test("cleanup follows confirmed process close for failure, timeout, cancellation, and heartbeat failure", async () => {
  for (const failure of [
    { code: "ffmpeg_failed", retryable: false },
    { code: "timeout", retryable: true },
    { code: "cancelled", retryable: true },
    { code: "heartbeat_failed", retryable: true },
  ]) {
    let processClosed = false;
    let cleaned = false;
    const provider = createFfmpegVideoProvider(providerOptions(1_250, {
      runProcess: async () => {
        processClosed = true;
        throw new VideoProviderError(failure.code, "Sanitized process failure.", failure.retryable);
      },
      cleanupRetryDelaysMs: [0],
      removeTemporaryDirectory: async (directory) => {
        assert.equal(processClosed, true);
        cleaned = true;
        await rm(directory, { recursive: true, force: true });
      },
    }));
    await assert.rejects(provider.render(request()), (error) => error.code === failure.code && error.retryable === failure.retryable);
    assert.equal(cleaned, true);
  }
});

test("unconfirmed termination settles immediately and defers retried cleanup until eventual close", async () => {
  let resolveClose;
  const closed = new Promise((resolve) => { resolveClose = resolve; });
  let closeConfirmed = false;
  let cleanupAttempts = 0;
  let cleanupFinished;
  const cleanupDone = new Promise((resolve) => { cleanupFinished = resolve; });
  const provider = createFfmpegVideoProvider(providerOptions(1_250, {
    cleanupRetryDelaysMs: [0, 0, 0],
    runProcess: async () => {
      throw new ProcessTerminationUnconfirmedError(
        new VideoProviderError("timeout", "Video generation timed out.", true),
        closed,
      );
    },
    removeTemporaryDirectory: async (directory) => {
      assert.equal(closeConfirmed, true);
      cleanupAttempts += 1;
      if (cleanupAttempts < 3) throw new Error("temporary Windows lock");
      await rm(directory, { recursive: true, force: true });
      cleanupFinished();
    },
  }));

  await assert.rejects(provider.render(request()), (error) => error.code === "process_termination_unconfirmed" && error.retryable === true);
  assert.equal(cleanupAttempts, 0);
  assert.equal(deferredMediaCleanupCountForTests(), 1);
  closeConfirmed = true;
  resolveClose();
  await cleanupDone;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanupAttempts, 3);
  assert.equal(deferredMediaCleanupCountForTests(), 0);
});

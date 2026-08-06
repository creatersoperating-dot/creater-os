/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { probeRenderedVideo } = require("./ffprobeValidation.server.ts");

function result(document, overrides = {}) {
  return {
    stdout: new TextEncoder().encode(JSON.stringify(document)),
    stderr: new Uint8Array(),
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

function validDocument() {
  return {
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.250000" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1280, height: 720, pix_fmt: "yuv420p", duration: "1.250000", nb_read_frames: "38" },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000", duration: "1.250000", nb_read_frames: "60" },
    ],
  };
}

async function probe(document, capture) {
  return probeRenderedVideo({
    ffprobePath: "C:\\private\\ffprobe.exe",
    cwd: "C:\\private\\render",
    fileName: "render.mp4",
    narrationDurationCeilingMs: 1_250,
    expectedDurationMs: 1_250,
    expectedWidth: 1280,
    expectedHeight: 720,
    expectedAudioSampleRate: 48_000,
    timeoutMs: 5_000,
    runProcess: async (request) => {
      if (capture) capture.request = request;
      return result(document);
    },
  });
}

test("accepts exactly one nonempty H.264/yuv420p video and AAC audio stream", async () => {
  const capture = {};
  assert.deepEqual(await probe(validDocument(), capture), { durationMs: 1_250, width: 1280, height: 720, hasAudio: true, audioSampleRate: 48_000 });
  assert.deepEqual(capture.request.args.slice(-3), ["-of", "json", "render.mp4"]);
  assert.equal(capture.request.captureStdout, true);
});

test("rejects missing, duplicate, wrong-codec, or empty audio streams", async () => {
  const missing = validDocument(); missing.streams.pop();
  await assert.rejects(probe(missing), (error) => error.code === "invalid_render" && error.retryable === false);
  const duplicate = validDocument(); duplicate.streams.push({ ...duplicate.streams[1] });
  await assert.rejects(probe(duplicate), /invalid or inconsistent/);
  const wrong = validDocument(); wrong.streams[1].codec_name = "mp3";
  await assert.rejects(probe(wrong), /invalid or inconsistent/);
  const empty = validDocument(); empty.streams[1].nb_read_frames = "0";
  await assert.rejects(probe(empty), /invalid or inconsistent/);
});

test("rejects wrong video codec, pixel format, dimensions, and invalid durations", async () => {
  const wrongCodec = validDocument(); wrongCodec.streams[0].codec_name = "hevc";
  await assert.rejects(probe(wrongCodec), /invalid or inconsistent/);
  const wrongPixelFormat = validDocument(); wrongPixelFormat.streams[0].pix_fmt = "yuv444p";
  await assert.rejects(probe(wrongPixelFormat), /invalid or inconsistent/);
  const wrongDimensions = validDocument(); wrongDimensions.streams[0].width = 1920;
  await assert.rejects(probe(wrongDimensions), /invalid or inconsistent/);
  const invalidDuration = validDocument(); invalidDuration.format.duration = "0";
  await assert.rejects(
    probe(invalidDuration),
    (error) => error?.code === "invalid_render" && error.retryable === false,
  );
});

test("rejects null, scalar, partial, duplicate-video, and invalid-numeric stream entries", async () => {
  for (const streams of [[null], [7], [{ codec_type: "audio" }]]) {
    await assert.rejects(probe({ format: { format_name: "mp4", duration: "1.25" }, streams }),
      (error) => error.code === "invalid_render" && error.retryable === false);
  }
  const duplicateVideo = validDocument(); duplicateVideo.streams.push({ ...duplicateVideo.streams[0] });
  await assert.rejects(probe(duplicateVideo), /invalid or inconsistent/);
  const invalidNumeric = validDocument(); invalidNumeric.streams[1].sample_rate = "Infinity";
  await assert.rejects(probe(invalidNumeric), /invalid or inconsistent/);
});

test("rejects missing or non-object format and safely ignores bounded irrelevant nesting", async () => {
  await assert.rejects(probe({ streams: validDocument().streams }), /invalid or inconsistent/);
  await assert.rejects(probe({ format: [], streams: validDocument().streams }), /invalid or inconsistent/);
  const nested = validDocument(); nested.irrelevant = { a: { b: { c: [1, 2, 3] } } };
  assert.equal((await probe(nested)).hasAudio, true);
});

test("rejects malformed JSON as a sanitized nonretryable render error", async () => {
  await assert.rejects(probeRenderedVideo({
    ffprobePath: "C:\\private\\ffprobe.exe", cwd: "C:\\private", fileName: "render.mp4",
    narrationDurationCeilingMs: 1_250, expectedDurationMs: 1_250,
    expectedWidth: 1280, expectedHeight: 720, expectedAudioSampleRate: 48_000, timeoutMs: 5_000,
    runProcess: async () => ({ stdout: new TextEncoder().encode('{"streams":['), stderr: new Uint8Array(), stdoutTruncated: false, stderrTruncated: false }),
  }), (error) => error.code === "invalid_render" && error.retryable === false && !error.message.includes("streams"));
});

test("rejects malformed or truncated bounded ffprobe output without exposing paths", async () => {
  await assert.rejects(probeRenderedVideo({
    ffprobePath: "C:\\private\\ffprobe.exe", cwd: "C:\\private", fileName: "render.mp4",
    narrationDurationCeilingMs: 1_250, expectedDurationMs: 1_250,
    expectedWidth: 1280, expectedHeight: 720, expectedAudioSampleRate: 48_000, timeoutMs: 5_000,
    runProcess: async () => result(validDocument(), { stdoutTruncated: true }),
  }), (error) => error.code === "invalid_render" && !error.message.includes("private"));
});

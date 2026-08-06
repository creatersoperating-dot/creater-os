/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { audioMuxLowerToleranceMs, validateVideoMuxDurations } = require("./videoMuxDurationPolicy.ts");

function durations(overrides = {}) {
  return {
    narrationDurationCeilingMs: 120_000,
    effectiveTimelineDurationMs: 120_000,
    audioDurationMs: 120_000,
    videoDurationMs: 120_000,
    containerDurationMs: 120_000,
    audioSampleRate: 48_000,
    ...overrides,
  };
}

test("accepts exact duration and approximately one AAC frame of lower-bound rounding", () => {
  assert.doesNotThrow(() => validateVideoMuxDurations(durations()));
  const oneFrame = audioMuxLowerToleranceMs(48_000);
  assert.doesNotThrow(() => validateVideoMuxDurations(durations({ audioDurationMs: 120_000 - oneFrame })));
});

test("rejects audio just beyond the AAC allowance, twenty percent short, or one minute short", () => {
  const allowance = audioMuxLowerToleranceMs(48_000);
  for (const audioDurationMs of [120_000 - allowance - 1, 96_000, 60_000]) {
    assert.throws(() => validateVideoMuxDurations(durations({ audioDurationMs })), (error) => error.code === "invalid_render" && error.retryable === false);
  }
});

test("rejects a short video or short container even when audio is complete", () => {
  assert.throws(() => validateVideoMuxDurations(durations({ videoDurationMs: 119_000 })), /incomplete or inconsistent/);
  assert.throws(() => validateVideoMuxDurations(durations({ containerDurationMs: 119_000 })), /incomplete or inconsistent/);
});

test("rejects output beyond the documented upper tolerance", () => {
  assert.throws(() => validateVideoMuxDurations(durations({ audioDurationMs: 120_251 })), /incomplete or inconsistent/);
});

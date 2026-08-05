import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATOROS_MAX_VIDEO_DURATION_MS,
  evaluateVideoDurationEligibility,
  isCompletedVideoDurationValid,
} from "./videoDurationContract.ts";

const MOCK_MAXIMUM_MS = 300_000;

test("platform and provider duration boundaries are explicit", () => {
  assert.deepEqual(evaluateVideoDurationEligibility(300_000, MOCK_MAXIMUM_MS), {
    maximumDurationMs: MOCK_MAXIMUM_MS, violation: null,
  });
  assert.equal(evaluateVideoDurationEligibility(300_001, MOCK_MAXIMUM_MS).violation, "provider_limit_exceeded");
  assert.equal(evaluateVideoDurationEligibility(300_001, CREATOROS_MAX_VIDEO_DURATION_MS).violation, null);
  assert.deepEqual(evaluateVideoDurationEligibility(1_800_000, CREATOROS_MAX_VIDEO_DURATION_MS), {
    maximumDurationMs: CREATOROS_MAX_VIDEO_DURATION_MS, violation: null,
  });
  assert.equal(evaluateVideoDurationEligibility(1_800_001, CREATOROS_MAX_VIDEO_DURATION_MS).violation, "platform_limit_exceeded");
});

test("completion preserves the twenty-percent or 250 ms tolerance", () => {
  assert.equal(isCompletedVideoDurationValid(300_000, 360_000), true);
  assert.equal(isCompletedVideoDurationValid(300_000, 360_001), false);
  assert.equal(isCompletedVideoDurationValid(1_000, 1_250), true);
  assert.equal(isCompletedVideoDurationValid(1_000, 1_251), false);
  assert.equal(isCompletedVideoDurationValid(1_800_000, 1_800_000), true);
  assert.equal(isCompletedVideoDurationValid(1_800_000, 1_800_001), false);
});

test("invalid provider limits and non-positive durations fail closed", () => {
  assert.equal(evaluateVideoDurationEligibility(250, 0).violation, "invalid_provider_limit");
  assert.equal(evaluateVideoDurationEligibility(0, MOCK_MAXIMUM_MS).violation, "invalid_duration");
});

export const CREATOROS_MAX_VIDEO_DURATION_MS = 1_800_000;
export const CREATOROS_MAX_VIDEO_SCENE_DURATION_MS = 120_000;
export const VIDEO_DURATION_TOLERANCE_FLOOR_MS = 250;

export type VideoDurationViolation =
  | "invalid_duration"
  | "invalid_provider_limit"
  | "platform_limit_exceeded"
  | "provider_limit_exceeded";

export interface VideoDurationEligibility {
  maximumDurationMs: number;
  violation: VideoDurationViolation | null;
}

export function evaluateVideoDurationEligibility(
  plannedDurationMs: number,
  providerMaximumDurationMs: number,
): VideoDurationEligibility {
  if (!Number.isSafeInteger(providerMaximumDurationMs) || providerMaximumDurationMs < VIDEO_DURATION_TOLERANCE_FLOOR_MS) {
    return { maximumDurationMs: 0, violation: "invalid_provider_limit" };
  }
  const maximumDurationMs = Math.min(providerMaximumDurationMs, CREATOROS_MAX_VIDEO_DURATION_MS);
  if (!Number.isSafeInteger(plannedDurationMs) || plannedDurationMs < 1) {
    return { maximumDurationMs, violation: "invalid_duration" };
  }
  if (plannedDurationMs > CREATOROS_MAX_VIDEO_DURATION_MS) {
    return { maximumDurationMs: CREATOROS_MAX_VIDEO_DURATION_MS, violation: "platform_limit_exceeded" };
  }
  if (plannedDurationMs > maximumDurationMs) {
    return { maximumDurationMs, violation: "provider_limit_exceeded" };
  }
  return { maximumDurationMs, violation: null };
}

export function isCompletedVideoDurationValid(plannedDurationMs: number, completedDurationMs: number): boolean {
  if (!Number.isSafeInteger(plannedDurationMs) || !Number.isSafeInteger(completedDurationMs)
    || plannedDurationMs < 1 || plannedDurationMs > CREATOROS_MAX_VIDEO_DURATION_MS
    || completedDurationMs < 1 || completedDurationMs > CREATOROS_MAX_VIDEO_DURATION_MS) return false;
  return Math.abs(completedDurationMs - plannedDurationMs)
    <= Math.max(plannedDurationMs * 0.2, VIDEO_DURATION_TOLERANCE_FLOOR_MS);
}

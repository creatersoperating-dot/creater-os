import "server-only";

import { VideoProviderError } from "@/services/providers/video/videoProviderTypes";
import { CREATOROS_MAX_VIDEO_DURATION_MS } from "@/services/video/videoDurationContract";

const AAC_SAMPLES_PER_FRAME = 1_024;
const TIMESTAMP_ROUNDING_TOLERANCE_MS = 2;
const VIDEO_FRAME_RATE = 30;

// One encoded frame may straddle the requested boundary; larger shortfalls are not narration-safe.
export const VIDEO_MUX_VIDEO_LOWER_TOLERANCE_MS = Math.ceil(1_000 / VIDEO_FRAME_RATE) + TIMESTAMP_ROUNDING_TOLERANCE_MS;
export const VIDEO_MUX_UPPER_TOLERANCE_MS = 250;

export interface VideoMuxDurationInput {
  narrationDurationCeilingMs: number;
  effectiveTimelineDurationMs: number;
  audioDurationMs: number;
  videoDurationMs: number;
  containerDurationMs: number;
  audioSampleRate: number;
}

function validDuration(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= CREATOROS_MAX_VIDEO_DURATION_MS + VIDEO_MUX_UPPER_TOLERANCE_MS;
}

function invalidMuxDuration(): never {
  throw new VideoProviderError("invalid_render", "FFmpeg returned incomplete or inconsistent stream durations.", false);
}

export function audioMuxLowerToleranceMs(sampleRate: number): number {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1) return 0;
  return Math.ceil((AAC_SAMPLES_PER_FRAME * 1_000) / sampleRate) + TIMESTAMP_ROUNDING_TOLERANCE_MS;
}

export function validateVideoMuxDurations(input: VideoMuxDurationInput): void {
  const { narrationDurationCeilingMs, effectiveTimelineDurationMs, audioDurationMs,
    videoDurationMs, containerDurationMs, audioSampleRate } = input;
  const audioLowerToleranceMs = audioMuxLowerToleranceMs(audioSampleRate);
  if (!Number.isSafeInteger(narrationDurationCeilingMs) || narrationDurationCeilingMs < 1
    || !Number.isSafeInteger(effectiveTimelineDurationMs) || effectiveTimelineDurationMs < narrationDurationCeilingMs
    || effectiveTimelineDurationMs > CREATOROS_MAX_VIDEO_DURATION_MS || audioLowerToleranceMs < 1
    || !validDuration(audioDurationMs) || !validDuration(videoDurationMs) || !validDuration(containerDurationMs)
    || audioDurationMs < narrationDurationCeilingMs - audioLowerToleranceMs
    || audioDurationMs < effectiveTimelineDurationMs - audioLowerToleranceMs
    || videoDurationMs < effectiveTimelineDurationMs - VIDEO_MUX_VIDEO_LOWER_TOLERANCE_MS
    || containerDurationMs < effectiveTimelineDurationMs - VIDEO_MUX_VIDEO_LOWER_TOLERANCE_MS
    || audioDurationMs > effectiveTimelineDurationMs + VIDEO_MUX_UPPER_TOLERANCE_MS
    || videoDurationMs > effectiveTimelineDurationMs + VIDEO_MUX_UPPER_TOLERANCE_MS
    || containerDurationMs > effectiveTimelineDurationMs + VIDEO_MUX_UPPER_TOLERANCE_MS) {
    return invalidMuxDuration();
  }
}

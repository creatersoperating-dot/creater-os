import "server-only";

import path from "node:path";

import { VideoProviderError } from "./videoProviderTypes";

export interface VideoProviderConfiguration {
  provider: "mock" | "ffmpeg" | "disabled"; model: string; fallbackProvider: "none"; timeoutMs: number;
  activeLeaseMs: number; heartbeatMs: number; ffmpegPath: string | null; ffprobePath: string | null;
}
function boundedMilliseconds(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? String(fallback));
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new VideoProviderError("configuration_invalid", `${name} is invalid.`);
  }
  return parsed;
}
export function getVideoProviderConfiguration(): VideoProviderConfiguration {
  const rawProvider = (process.env.CREATOROS_VIDEO_PROVIDER ?? (process.env.NODE_ENV === "development" ? "mock" : "disabled")).trim().toLowerCase();
  if (rawProvider !== "mock" && rawProvider !== "ffmpeg" && rawProvider !== "disabled") {
    throw new VideoProviderError("provider_unsupported", "The configured video provider is unsupported.");
  }
  if (rawProvider === "mock" && process.env.NODE_ENV === "production") {
    throw new VideoProviderError("mock_forbidden", "The development video renderer is unavailable in production.");
  }
  const fallback = (process.env.CREATOROS_VIDEO_FALLBACK_PROVIDER ?? "none").trim().toLowerCase();
  if (fallback !== "none") throw new VideoProviderError("fallback_unsupported", "Automatic video-provider fallback is disabled.");
  const timeoutMs = boundedMilliseconds("CREATOROS_VIDEO_REQUEST_TIMEOUT_MS", 240_000, 30_000, 300_000);
  const heartbeatMs = boundedMilliseconds("CREATOROS_VIDEO_HEARTBEAT_MS", 5_000, 1_000, 30_000);
  const activeLeaseMs = boundedMilliseconds("CREATOROS_VIDEO_ACTIVE_LEASE_MS", 30_000, 15_000, 120_000);
  if (activeLeaseMs < heartbeatMs * 3) {
    throw new VideoProviderError("configuration_invalid", "The video operation lease must be at least three heartbeat intervals.");
  }
  const defaultModel = rawProvider === "mock" ? "mock-render-v1" : rawProvider === "ffmpeg" ? "ffmpeg-h264-aac-v1" : "disabled";
  const model = (process.env.CREATOROS_VIDEO_MODEL ?? defaultModel).trim();
  let ffmpegPath: string | null = null;
  let ffprobePath: string | null = null;
  if (rawProvider === "ffmpeg") {
    if (model !== "ffmpeg-h264-aac-v1") {
      throw new VideoProviderError("model_unavailable", "The configured FFmpeg video model is unsupported.");
    }
    const configuredPath = (process.env.CREATOROS_FFMPEG_PATH ?? "").trim();
    if (!configuredPath) {
      throw new VideoProviderError("configuration_invalid", "CREATOROS_FFMPEG_PATH is required for the FFmpeg video provider.");
    }
    if (configuredPath.includes("\0") || !path.isAbsolute(configuredPath)) {
      throw new VideoProviderError("configuration_invalid", "CREATOROS_FFMPEG_PATH must be an absolute executable path.");
    }
    const configuredProbePath = (process.env.CREATOROS_FFPROBE_PATH ?? "").trim();
    if (!configuredProbePath) {
      throw new VideoProviderError("configuration_invalid", "CREATOROS_FFPROBE_PATH is required for the FFmpeg video provider.");
    }
    if (configuredProbePath.includes("\0") || !path.isAbsolute(configuredProbePath)) {
      throw new VideoProviderError("configuration_invalid", "CREATOROS_FFPROBE_PATH must be an absolute executable path.");
    }
    ffmpegPath = configuredPath;
    ffprobePath = configuredProbePath;
  }
  return { provider: rawProvider, model, fallbackProvider: "none", timeoutMs, activeLeaseMs, heartbeatMs, ffmpegPath, ffprobePath };
}

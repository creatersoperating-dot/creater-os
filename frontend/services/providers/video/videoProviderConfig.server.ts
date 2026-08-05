import "server-only";

import { VideoProviderError } from "./videoProviderTypes";

export interface VideoProviderConfiguration {
  provider: "mock" | "disabled"; model: string; fallbackProvider: "none"; timeoutMs: number;
  activeLeaseMs: number; heartbeatMs: number;
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
  if (rawProvider !== "mock" && rawProvider !== "disabled") {
    throw new VideoProviderError("configuration_invalid", "The configured video provider is unsupported.");
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
  return { provider: rawProvider, model: (process.env.CREATOROS_VIDEO_MODEL ?? (rawProvider === "mock" ? "mock-render-v1" : "disabled")).trim(), fallbackProvider: "none", timeoutMs, activeLeaseMs, heartbeatMs };
}

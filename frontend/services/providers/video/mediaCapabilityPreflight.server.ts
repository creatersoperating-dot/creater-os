import "server-only";

import { runMediaProcess, type MediaProcessRunner } from "./mediaProcess.server";
import { VideoProviderError } from "./videoProviderTypes";

const MAX_PREFLIGHT_OUTPUT_BYTES = 512 * 1024;
const preflightPromises = new Map<string, Promise<void>>();

export interface MediaCapabilityPreflightRequest {
  ffmpegPath: string;
  ffprobePath: string;
  model: string;
  timeoutMs: number;
  signal?: AbortSignal;
  heartbeat?: () => Promise<void>;
  runProcess?: MediaProcessRunner;
}

function configurationFailure(): never {
  throw new VideoProviderError(
    "configuration_invalid",
    "The configured FFmpeg installation must provide libx264, AAC, and ffprobe.",
    false,
  );
}

async function executePreflight(request: MediaCapabilityPreflightRequest): Promise<void> {
  const execute = request.runProcess ?? runMediaProcess;
  try {
    const encoders = await execute({
      executablePath: request.ffmpegPath,
      args: ["-hide_banner", "-encoders"],
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      heartbeat: request.heartbeat,
      captureStdout: true,
      captureStderr: true,
      maxCaptureBytes: MAX_PREFLIGHT_OUTPUT_BYTES,
      unavailableCode: "ffmpeg_unavailable",
      unavailableMessage: "The configured FFmpeg executable could not be started.",
      failureCode: "configuration_invalid",
      failureMessage: "The configured FFmpeg installation could not be inspected.",
      failureRetryable: false,
    });
    if (encoders.stdoutTruncated || encoders.stderrTruncated) return configurationFailure();
    const listing = `${new TextDecoder().decode(encoders.stdout)}\n${new TextDecoder().decode(encoders.stderr)}`;
    if (!/(^|\s)libx264(\s|$)/m.test(listing) || !/(^|\s)aac(\s|$)/m.test(listing)) return configurationFailure();

    await execute({
      executablePath: request.ffprobePath,
      args: ["-v", "error", "-version"],
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      heartbeat: request.heartbeat,
      maxCaptureBytes: MAX_PREFLIGHT_OUTPUT_BYTES,
      unavailableCode: "ffprobe_unavailable",
      unavailableMessage: "The configured ffprobe executable could not be started.",
      failureCode: "configuration_invalid",
      failureMessage: "The configured ffprobe installation could not be inspected.",
      failureRetryable: false,
    });
  } catch (error) {
    if (error instanceof VideoProviderError) throw error;
    return configurationFailure();
  }
}

export function preflightMediaCapabilities(request: MediaCapabilityPreflightRequest): Promise<void> {
  const cacheKey = `${request.ffmpegPath}\0${request.ffprobePath}\0${request.model}`;
  const existing = preflightPromises.get(cacheKey);
  if (existing) return existing;
  const pending = executePreflight(request).catch((error: unknown) => {
    if (preflightPromises.get(cacheKey) === pending) preflightPromises.delete(cacheKey);
    throw error;
  });
  preflightPromises.set(cacheKey, pending);
  return pending;
}

export function clearMediaCapabilityPreflightCacheForTests(): void {
  preflightPromises.clear();
}

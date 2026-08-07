import "server-only";

import { readFile, rm, stat, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import sharp from "sharp";

import { validateMp4, type ValidatedMp4Metadata } from "@/services/video/mp4Validation.server";
import { CREATOROS_MAX_VIDEO_DURATION_MS, isCompletedVideoDurationValid } from "@/services/video/videoDurationContract";
import { validateCreatorOsWav } from "@/services/video/wavValidation.server";

import { registerDeferredMediaCleanup } from "./deferredMediaCleanup.server";
import { probeRenderedVideo, type ProbeRenderedVideoRequest, type ProbedVideoMetadata } from "./ffprobeValidation.server";
import { preflightMediaCapabilities } from "./mediaCapabilityPreflight.server";
import { ProcessTerminationUnconfirmedError, runMediaProcess, type MediaProcessRequest, type MediaProcessResult, type MediaProcessRunner } from "./mediaProcess.server";

import type {
  VideoRendererAdapter,
  VideoRenderRequest,
  VideoRenderVisualAssetInput,
} from "./videoProviderTypes";
import { VideoProviderError } from "./videoProviderTypes";

const MODEL = "ffmpeg-h264-aac-v1";
const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_RATE = 30;
const MAX_SCENES = 24;
const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;

export type FfmpegProcessRequest = MediaProcessRequest;
export type FfmpegProcessRunner = MediaProcessRunner;

export interface FfmpegProviderOptions {
  executablePath: string;
  ffprobePath: string;
  timeoutMs: number;
  runProcess?: FfmpegProcessRunner;
  createTemporaryDirectory?: () => Promise<string>;
  removeTemporaryDirectory?: (directory: string) => Promise<void>;
  inspectOutput?: (bytes: Uint8Array) => ValidatedMp4Metadata;
  probeOutput?: (request: ProbeRenderedVideoRequest) => Promise<ProbedVideoMetadata>;
  preflight?: (request: VideoRenderRequest) => Promise<void>;
  cleanupRetryDelaysMs?: readonly number[];
}

function abortError(signal?: AbortSignal): VideoProviderError {
  const reason = signal?.reason;
  if (reason instanceof VideoProviderError) return reason;
  if (reason && typeof reason === "object" && "code" in reason && reason.code === "timeout") {
    return new VideoProviderError("timeout", "Video generation timed out.", true);
  }
  return new VideoProviderError("cancelled", "Video rendering was cancelled.", true);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function safeLog(label: string, details: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "development") console.warn(label, details);
}

export function runFfmpegProcess(request: FfmpegProcessRequest): Promise<MediaProcessResult> {
  return runMediaProcess({
    ...request,
    unavailableCode: "ffmpeg_unavailable",
    unavailableMessage: "The configured FFmpeg executable could not be started.",
    failureCode: "ffmpeg_failed",
    failureMessage: "FFmpeg could not render the video.",
    failureRetryable: false,
  });
}

function validateRequest(request: VideoRenderRequest): number {
  if (request.model !== MODEL) throw new VideoProviderError("model_unavailable", "The configured FFmpeg video model is unsupported.");
  if (!request.projectId.trim() || request.scenes.length < 1 || request.scenes.length > MAX_SCENES) {
    throw new VideoProviderError("invalid_request", "The video render request is invalid.");
  }
  if (request.audio.bytes.byteLength === 0 || request.audio.mimeType !== "audio/wav"
    || !Number.isSafeInteger(request.audio.durationMs) || request.audio.durationMs < 1) {
    throw new VideoProviderError("invalid_audio", "The attached narration is invalid.");
  }
  const durationMs = request.scenes.reduce((total, scene) => total + scene.durationMs, 0);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > CREATOROS_MAX_VIDEO_DURATION_MS
    || request.scenes.some((scene, index) => !Number.isSafeInteger(scene.durationMs) || scene.durationMs < 1 || scene.sceneNumber !== index + 1)) {
    throw new VideoProviderError("duration_unsupported", "The FFmpeg renderer supports videos up to 30 minutes.");
  }
  validateVisualAssetOrder(request.scenes, request.visualAssets);
  throwIfAborted(request.signal);
  return durationMs;
}

function validateVisualAssetOrder(
  scenes: VideoRenderRequest["scenes"],
  assets: readonly VideoRenderVisualAssetInput[] | undefined,
): asserts assets is readonly VideoRenderVisualAssetInput[] {
  if (!assets || assets.length !== scenes.length || assets.some((asset, index) => {
    const scene = scenes[index];
    const typeMatches = (asset.format === "svg" && asset.mimeType === "image/svg+xml")
      || (asset.format === "png" && asset.mimeType === "image/png")
      || (asset.format === "jpeg" && asset.mimeType === "image/jpeg");
    return asset.sceneId !== scene.id || asset.sceneNumber !== scene.sceneNumber || asset.bytes.byteLength === 0
      || !typeMatches || asset.width < 1 || asset.height < 1;
  })) {
    throw new VideoProviderError("invalid_asset_set", "The authoritative scene visual set is invalid or out of order.");
  }
}

export function extendFinalSceneForNarration(
  scenes: VideoRenderRequest["scenes"],
  narrationDurationCeilingMs: number,
): { scenes: VideoRenderRequest["scenes"]; durationMs: number } {
  const plannedDurationMs = scenes.reduce((total, scene) => total + scene.durationMs, 0);
  const durationMs = Math.max(plannedDurationMs, narrationDurationCeilingMs);
  if (durationMs > CREATOROS_MAX_VIDEO_DURATION_MS) {
    throw new VideoProviderError("duration_unsupported", "The FFmpeg renderer supports videos up to 30 minutes.", false);
  }
  if (durationMs === plannedDurationMs) return { scenes, durationMs };
  return {
    scenes: scenes.map((scene, index) => index === scenes.length - 1
      ? { ...scene, durationMs: scene.durationMs + durationMs - plannedDurationMs }
      : scene),
    durationMs,
  };
}

export function timelineFile(scenes: VideoRenderRequest["scenes"]): string {
  const lines = ["ffconcat version 1.0"];
  scenes.forEach((scene, index) => {
    lines.push(`file 'scene-${String(index + 1).padStart(4, "0")}.png'`);
    lines.push(`duration ${(scene.durationMs / 1000).toFixed(6)}`);
  });
  lines.push(`file 'scene-${String(scenes.length).padStart(4, "0")}.png'`);
  return `${lines.join("\n")}\n`;
}

export function buildFfmpegArguments(durationMs: number): string[] {
  const durationSeconds = (durationMs / 1000).toFixed(6);
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "concat", "-safe", "1", "-i", "timeline.ffconcat",
    "-i", "narration.wav",
    "-map", "0:v:0", "-map", "1:a:0",
    "-vf", `fps=${FRAME_RATE},format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-af", `apad=whole_dur=${durationSeconds}`,
    "-t", durationSeconds, "-movflags", "+faststart", "-map_metadata", "-1", "render.mp4",
  ];
}

async function prepareFrame(asset: VideoRenderVisualAssetInput, destination: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  try {
    await sharp(Buffer.from(asset.bytes), { limitInputPixels: 100_000_000 })
      .resize(WIDTH, HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .png()
      .toFile(destination);
  } catch {
    throwIfAborted(signal);
    throw new VideoProviderError("invalid_asset", "An authoritative scene visual is invalid.", false);
  }
  throwIfAborted(signal);
}

async function removeTemporaryDirectoryWithRetries(
  directory: string,
  removeDirectory: (directory: string) => Promise<void>,
  retryDelaysMs: readonly number[],
): Promise<void> {
  let lastError: unknown;
  for (const retryDelayMs of retryDelaysMs) {
    if (retryDelayMs > 0) await delay(retryDelayMs);
    try {
      await removeDirectory(directory);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  void lastError;
  throw new VideoProviderError("cleanup_failed", "Temporary video render files could not be removed.", true);
}

export function createFfmpegVideoProvider(options: FfmpegProviderOptions): VideoRendererAdapter {
  const runProcess = options.runProcess ?? runFfmpegProcess;
  const createTemporaryDirectory = options.createTemporaryDirectory
    ?? (() => mkdtemp(path.join(tmpdir(), "creatoros-ffmpeg-")));
  const removeTemporaryDirectory = options.removeTemporaryDirectory
    ?? ((directory: string) => rm(directory, { recursive: true, force: true }));
  const inspectOutput = options.inspectOutput ?? validateMp4;
  const probeOutput = options.probeOutput ?? probeRenderedVideo;
  const preflight = options.preflight ?? ((request: VideoRenderRequest) => preflightMediaCapabilities({
    ffmpegPath: options.executablePath,
    ffprobePath: options.ffprobePath,
    model: MODEL,
    timeoutMs: options.timeoutMs,
    signal: request.signal,
    heartbeat: request.heartbeat,
    runProcess,
  }));
  const cleanupRetryDelaysMs = options.cleanupRetryDelaysMs ?? [0, 50, 200];

  return {
    descriptor: {
      id: "ffmpeg",
      label: "CreatorOS FFmpeg renderer",
      developmentOnly: false,
      capabilities: { containers: ["mp4"], supportsAudioMux: true, maximumDurationMs: CREATOROS_MAX_VIDEO_DURATION_MS, maximumScenes: MAX_SCENES },
    },
    async render(request) {
      validateRequest(request);
      const validatedWav = validateCreatorOsWav(request.audio.bytes, request.audio.durationMs);
      const timeline = extendFinalSceneForNarration(request.scenes, validatedWav.durationCeilingMs);
      const visualAssets = request.visualAssets as readonly VideoRenderVisualAssetInput[];
      let directory: string | null = null;
      let result: Awaited<ReturnType<VideoRendererAdapter["render"]>> | null = null;
      let renderFailure: unknown;
      let deferredClose: Promise<void> | null = null;
      try {
        await preflight(request);
        throwIfAborted(request.signal);
        directory = await createTemporaryDirectory();
        throwIfAborted(request.signal);
        for (let index = 0; index < visualAssets.length; index += 1) {
          await prepareFrame(visualAssets[index], path.join(directory, `scene-${String(index + 1).padStart(4, "0")}.png`), request.signal);
          await request.heartbeat?.();
          throwIfAborted(request.signal);
        }
        await Promise.all([
          writeFile(path.join(directory, "narration.wav"), request.audio.bytes),
          writeFile(path.join(directory, "timeline.ffconcat"), timelineFile(timeline.scenes), "utf8"),
        ]);
        throwIfAborted(request.signal);
        await runProcess({
          executablePath: options.executablePath,
          args: buildFfmpegArguments(timeline.durationMs),
          cwd: directory,
          signal: request.signal,
          timeoutMs: options.timeoutMs,
          heartbeat: request.heartbeat,
        });
        throwIfAborted(request.signal);
        const outputPath = path.join(directory, "render.mp4");
        const outputStat = await stat(outputPath);
        if (!outputStat.isFile() || outputStat.size < 1 || outputStat.size > MAX_OUTPUT_BYTES) {
          throw new VideoProviderError("invalid_render", "FFmpeg returned an invalid video.");
        }
        const bytes = new Uint8Array(await readFile(outputPath));
        const structuralMetadata = inspectOutput(bytes);
        if (!structuralMetadata.fastStart || structuralMetadata.width !== WIDTH || structuralMetadata.height !== HEIGHT
          || !structuralMetadata.hasAudio || !isCompletedVideoDurationValid(timeline.durationMs, structuralMetadata.durationMs)) {
          throw new VideoProviderError("invalid_render", "FFmpeg returned inconsistent video metadata.");
        }
        const metadata = await probeOutput({
          ffprobePath: options.ffprobePath,
          cwd: directory,
          fileName: "render.mp4",
          narrationDurationCeilingMs: validatedWav.durationCeilingMs,
          expectedDurationMs: timeline.durationMs,
          expectedWidth: WIDTH,
          expectedHeight: HEIGHT,
          expectedAudioSampleRate: 48_000,
          timeoutMs: options.timeoutMs,
          signal: request.signal,
          heartbeat: request.heartbeat,
          runProcess,
        });
        if (metadata.durationMs !== structuralMetadata.durationMs) {
          throw new VideoProviderError("invalid_render", "FFmpeg returned inconsistent video metadata.", false);
        }
        result = {
          bytes,
          format: "mp4",
          mimeType: "video/mp4",
          width: metadata.width,
          height: metadata.height,
          durationMs: metadata.durationMs,
          hasAudio: metadata.hasAudio,
          providerRequestId: `ffmpeg-${request.projectId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}-${request.scenes.length}`,
        };
      } catch (error) {
        if (error instanceof ProcessTerminationUnconfirmedError) deferredClose = error.closed;
        renderFailure = error instanceof VideoProviderError
          ? error
          : request.signal?.aborted
            ? abortError(request.signal)
            : new VideoProviderError("render_failed", "FFmpeg could not render the video.", true);
      }
      if (directory && deferredClose) {
        const renderDirectory = directory;
        const cleanupTask = registerDeferredMediaCleanup(
          deferredClose,
          () => removeTemporaryDirectoryWithRetries(renderDirectory, removeTemporaryDirectory, cleanupRetryDelaysMs),
          () => safeLog("[CreatorOS deferred video cleanup failed]", { stage: "deferred_cleanup", errorName: "CleanupError" }),
        );
        if (!cleanupTask) safeLog("[CreatorOS deferred video cleanup capacity reached]", { stage: "deferred_cleanup", errorName: "CapacityError" });
      } else if (directory) {
        await removeTemporaryDirectoryWithRetries(directory, removeTemporaryDirectory, cleanupRetryDelaysMs);
      }
      if (renderFailure) throw renderFailure;
      if (!result) throw new VideoProviderError("render_failed", "FFmpeg could not render the video.", true);
      return result;
    },
  };
}

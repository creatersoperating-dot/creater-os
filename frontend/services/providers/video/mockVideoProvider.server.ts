import "server-only";

import * as HME from "h264-mp4-encoder";
import sharp from "sharp";

import type { VideoProviderAdapter, VideoRenderRequest, VideoVisualAssetResult } from "./videoProviderTypes";
import { VideoProviderError } from "./videoProviderTypes";
import { allocateFrameCountsForDurations, MOCK_VIDEO_FRAME_RATE } from "@/services/video/videoScenePlanning.server";
import { normalizeMp4Timestamps } from "@/services/video/mp4Validation.server";

const WIDTH = 480;
const HEIGHT = 270;
const FRAME_RATE = MOCK_VIDEO_FRAME_RATE;
const ENCODE_BATCH_FRAMES = 8;
const MOCK_MAX_VIDEO_DURATION_MS = 300_000;
const encoder = new TextEncoder();

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}
function clipped(value: string, maximum: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1)}…`;
}
function assertRequest(request: VideoRenderRequest): void {
  if (process.env.NODE_ENV === "production") throw new VideoProviderError("mock_forbidden", "The development video renderer is unavailable in production.");
  if (request.model !== "mock-render-v1") throw new VideoProviderError("model_unavailable", "The configured video renderer is unavailable.");
  if (!request.projectId.trim() || request.scenes.length < 1 || request.scenes.length > 24) throw new VideoProviderError("invalid_request", "The video render request is invalid.");
  if (request.audio.bytes.byteLength === 0 || request.audio.durationMs <= 0) throw new VideoProviderError("invalid_audio", "The attached narration is invalid.");
  const plannedDurationMs = request.scenes.reduce((total, scene) => total + scene.durationMs, 0);
  if (!Number.isSafeInteger(plannedDurationMs) || plannedDurationMs < 1 || plannedDurationMs > MOCK_MAX_VIDEO_DURATION_MS) {
    throw new VideoProviderError("duration_unsupported", "The mock renderer supports videos up to five minutes.");
  }
  throwIfAborted(request.signal);
}
function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof VideoProviderError) throw signal.reason;
  if (signal.reason && typeof signal.reason === "object" && "code" in signal.reason) {
    const code = signal.reason.code;
    if (code === "timeout") throw new VideoProviderError("timeout", "Video generation timed out.", true);
    if (code === "cancelled") throw new VideoProviderError("cancelled", "Video rendering was cancelled.", true);
  }
  throw new VideoProviderError("cancelled", "Video rendering was cancelled.", true);
}
async function yieldToEventLoop(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  throwIfAborted(signal);
}
function blendFrames(previous: Uint8Array, current: Uint8Array, ratio: number): Uint8Array {
  const blended = new Uint8Array(current.length);
  for (let index = 0; index < current.length; index += 1) {
    blended[index] = Math.round(previous[index] * (1 - ratio) + current[index] * ratio);
  }
  return blended;
}
function makeSvg(request: VideoRenderRequest, index: number): string {
  const scene = request.scenes[index];
  const hue = (scene.sceneNumber * 53 + 211) % 360;
  const excerpt = clipped(scene.narrationText || scene.visualPrompt, 110);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 78% 32%)"/><stop offset="1" stop-color="hsl(${(hue + 72) % 360} 75% 12%)"/></linearGradient></defs><rect width="480" height="270" fill="url(#g)"/><circle cx="430" cy="45" r="75" fill="white" opacity=".08"/><text x="28" y="38" font-family="Arial,sans-serif" font-size="12" fill="white" opacity=".78">CREATOROS MOCK VIDEO · SCENE ${scene.sceneNumber}/${request.scenes.length}</text><text x="28" y="100" font-family="Arial,sans-serif" font-weight="700" font-size="27" fill="white">${escapeXml(clipped(scene.title, 31))}</text><foreignObject x="28" y="120" width="410" height="92"><div xmlns="http://www.w3.org/1999/xhtml" style="font:16px/1.45 Arial,sans-serif;color:white;opacity:.9">${escapeXml(excerpt)}</div></foreignObject><text x="28" y="246" font-family="Arial,sans-serif" font-size="11" fill="white" opacity=".7">${escapeXml(clipped(request.projectTitle, 48))} · ${escapeXml(scene.visualType)}</text></svg>`;
}

function visualAssets(request: VideoRenderRequest): VideoVisualAssetResult[] {
  return request.scenes.map((_, index) => {
    const svg = makeSvg(request, index);
    return { sceneId: request.scenes[index].id, sceneNumber: request.scenes[index].sceneNumber,
      bytes: encoder.encode(svg), format: "svg", mimeType: "image/svg+xml", width: WIDTH, height: HEIGHT };
  });
}

export const mockVideoProvider: VideoProviderAdapter = {
  descriptor: { id: "mock", label: "CreatorOS development renderer", developmentOnly: true,
    capabilities: { containers: ["mp4"], supportsAudioMux: false, maximumDurationMs: MOCK_MAX_VIDEO_DURATION_MS, maximumScenes: 24 } },
  async generateVisualAssets(request) {
    assertRequest(request);
    await request.heartbeat?.();
    throwIfAborted(request.signal);
    return visualAssets(request);
  },
  async render(request) {
    assertRequest(request);
    const frameCounts = allocateFrameCountsForDurations(request.scenes.map((scene) => scene.durationMs));
    const totalFrames = frameCounts.reduce((sum, count) => sum + count, 0);
    const encodedDurationMs = totalFrames * 1000 / FRAME_RATE;
    if (encodedDurationMs > MOCK_MAX_VIDEO_DURATION_MS) throw new VideoProviderError("duration_unsupported", "The mock renderer supports videos up to five minutes.");
    const svgs = request.scenes.map((_, index) => makeSvg(request, index));
    const frames = await Promise.all(svgs.map(async (svg) => new Uint8Array(await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer())));
    throwIfAborted(request.signal);
    const mp4 = await HME.createH264MP4Encoder();
    try {
      mp4.width = WIDTH; mp4.height = HEIGHT; mp4.frameRate = FRAME_RATE; mp4.quantizationParameter = 24; mp4.initialize();
      let framesSinceYield = 0;
      for (let index = 0; index < request.scenes.length; index += 1) {
        throwIfAborted(request.signal);
        const frameCount = frameCounts[index];
        for (let frame = 0; frame < frameCount; frame += 1) {
          throwIfAborted(request.signal);
          const transitionFrames = Math.min(FRAME_RATE, frameCount);
          const renderedFrame = index > 0 && request.scenes[index].transition !== "cut" && frame < transitionFrames
            ? blendFrames(frames[index - 1], frames[index], (frame + 1) / transitionFrames)
            : frames[index];
          mp4.addFrameRgba(renderedFrame);
          framesSinceYield += 1;
          if (framesSinceYield >= ENCODE_BATCH_FRAMES) {
            framesSinceYield = 0;
            await yieldToEventLoop(request.signal);
            await request.heartbeat?.();
            throwIfAborted(request.signal);
          }
        }
      }
      throwIfAborted(request.signal);
      mp4.finalize();
      const bytes = normalizeMp4Timestamps(new Uint8Array(mp4.FS.readFile(mp4.outputFilename)));
      return { bytes, format: "mp4", mimeType: "video/mp4", width: WIDTH, height: HEIGHT,
        durationMs: encodedDurationMs, hasAudio: false,
        providerRequestId: `mock-${request.projectId.slice(0, 8)}-${request.scenes.length}-${totalFrames}` };
    } finally { mp4.delete(); }
  },
};

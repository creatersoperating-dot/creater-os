import "server-only";

import { createHash } from "node:crypto";

import { GoogleGenAI, Modality } from "@google/genai";
import sharp from "sharp";

import { buildGeminiVisualPrompt } from "./visualPromptBuilder";
import {
  VideoProviderError,
  type VideoVisualAssetResult,
  type VisualAssetGenerationRequest,
  type VisualAssetProviderAdapter,
} from "./videoProviderTypes";

const MODEL = "gemini-3.1-flash-image";
const WIDTH = 1280;
const HEIGHT = 720;
const MAX_SCENES = 24;
const MAX_ENCODED_IMAGE_CHARACTERS = 16 * 1024 * 1024;
const MAX_INPUT_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_INPUT_DIMENSION = 8192;
const MAX_INPUT_PIXELS = 40_000_000;
const SUPPORTED_MIME_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpeg"],
  ["image/webp", "webp"],
] as const);

export interface GeminiImageClientRequest {
  model: string;
  prompt: string;
  sceneId: string;
  sceneNumber: number;
  signal: AbortSignal;
}

export interface GeminiImageClientResponse {
  requestSceneId: string;
  requestSceneNumber: number;
  responseId?: unknown;
  candidates?: unknown;
}

export interface GeminiImageClient {
  generateImage(request: GeminiImageClientRequest): Promise<GeminiImageClientResponse>;
}

export interface GeminiVisualProviderOptions {
  apiKey: string;
  timeoutMs: number;
  maxConcurrency: number;
  client?: GeminiImageClient;
  maximumOutputBytes?: number;
  maximumTotalOutputBytes?: number;
  timeoutScheduler?: (onTimeout: () => void, timeoutMs: number) => unknown;
  timeoutCanceller?: (handle: unknown) => void;
}

function createSdkClient(apiKey: string): GeminiImageClient {
  const sdk = new GoogleGenAI({ apiKey });
  return {
    async generateImage(request) {
      const response = await sdk.models.generateContent({
        model: request.model,
        contents: request.prompt,
        config: {
          abortSignal: request.signal,
          candidateCount: 1,
          responseModalities: [Modality.IMAGE],
          imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
        },
      });
      return {
        requestSceneId: request.sceneId,
        requestSceneNumber: request.sceneNumber,
        responseId: response.responseId,
        candidates: response.candidates,
      };
    },
  };
}

function providerRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function heartbeatError(error: unknown): VideoProviderError {
  return error instanceof VideoProviderError
    ? error
    : new VideoProviderError("lease_heartbeat_failed", "The video operation heartbeat failed.", true);
}

async function heartbeat(request: VisualAssetGenerationRequest): Promise<void> {
  try {
    await request.heartbeat?.();
  } catch (error) {
    throw heartbeatError(error);
  }
}

function abortError(signal: AbortSignal): VideoProviderError {
  if (signal.reason instanceof VideoProviderError) return signal.reason;
  if (signal.reason && typeof signal.reason === "object" && "code" in signal.reason) {
    if (signal.reason.code === "timeout") return new VideoProviderError("timeout", "Visual generation timed out.", true);
    if (signal.reason.code === "cancelled") return new VideoProviderError("cancelled", "Visual generation was cancelled.", true);
  }
  return new VideoProviderError("cancelled", "Visual generation was cancelled.", true);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function classifyProviderFailure(error: unknown, signal: AbortSignal): VideoProviderError {
  if (error instanceof VideoProviderError) return error;
  if (signal.aborted) return abortError(signal);
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const status = typeof record?.status === "number" ? record.status
    : typeof record?.statusCode === "number" ? record.statusCode : null;
  const code = typeof record?.code === "string" ? record.code.toUpperCase() : "";
  const cause = record?.cause && typeof record.cause === "object" ? record.cause as Record<string, unknown> : null;
  const causeCode = typeof cause?.code === "string" ? cause.code.toUpperCase() : "";
  const name = typeof record?.name === "string" ? record.name : "";
  if (status === 429 || code === "429" || code === "RESOURCE_EXHAUSTED") {
    return new VideoProviderError("visual_rate_limited", "Visual generation was rate limited.", true);
  }
  if (status === 408 || status === 504 || code === "ETIMEDOUT" || code === "DEADLINE_EXCEEDED" || name === "TimeoutError") {
    return new VideoProviderError("timeout", "Visual generation timed out.", true);
  }
  if ((status !== null && status >= 500)
    || ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH"].includes(code)
    || ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH"].includes(causeCode)) {
    return new VideoProviderError("visual_provider_unavailable", "The visual provider is temporarily unavailable.", true);
  }
  return new VideoProviderError("visual_provider_failed", "Gemini could not generate a scene visual.", false);
}

function imageParts(response: GeminiImageClientResponse): readonly { mimeType: unknown; data: unknown }[] {
  if (!Array.isArray(response.candidates)) return [];
  const images: { mimeType: unknown; data: unknown }[] = [];
  for (const candidate of response.candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object" || !("inlineData" in part)) continue;
      const inlineData = (part as { inlineData?: unknown }).inlineData;
      if (!inlineData || typeof inlineData !== "object") {
        images.push({ mimeType: undefined, data: undefined });
      } else {
        images.push({
          mimeType: (inlineData as { mimeType?: unknown }).mimeType,
          data: (inlineData as { data?: unknown }).data,
        });
      }
    }
  }
  return images;
}

function decodeImage(image: { mimeType: unknown; data: unknown }): { bytes: Uint8Array; expectedFormat: string } {
  if (typeof image.mimeType !== "string" || !SUPPORTED_MIME_TYPES.has(image.mimeType as never)) {
    throw new VideoProviderError("visual_format_unsupported", "Gemini returned an unsupported image format.", false);
  }
  if (typeof image.data !== "string" || image.data.length === 0
    || image.data.length > MAX_ENCODED_IMAGE_CHARACTERS || image.data.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)) {
    throw new VideoProviderError("visual_response_invalid", "Gemini returned invalid image data.", false);
  }
  const decoded = Buffer.from(image.data, "base64");
  if (decoded.byteLength === 0 || decoded.byteLength > MAX_INPUT_IMAGE_BYTES
    || decoded.toString("base64") !== image.data) {
    throw new VideoProviderError("visual_response_invalid", "Gemini returned invalid image data.", false);
  }
  return { bytes: new Uint8Array(decoded), expectedFormat: SUPPORTED_MIME_TYPES.get(image.mimeType as never) as string };
}

async function normalizeImage(bytes: Uint8Array, expectedFormat: string, maximumOutputBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  try {
    const input = sharp(Buffer.from(bytes), { limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    const metadata = await input.metadata();
    throwIfAborted(signal);
    if (metadata.format !== expectedFormat || !Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
      || !metadata.width || !metadata.height || metadata.width > MAX_INPUT_DIMENSION || metadata.height > MAX_INPUT_DIMENSION
      || metadata.width * metadata.height > MAX_INPUT_PIXELS || (metadata.pages ?? 1) !== 1) {
      throw new VideoProviderError("visual_image_unsafe", "Gemini returned an unsafe image.", false);
    }
    const output = await input.rotate().resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    throwIfAborted(signal);
    if (output.byteLength === 0 || output.byteLength > maximumOutputBytes) {
      throw new VideoProviderError("visual_image_oversized", "The normalized scene visual is too large.", false);
    }
    const normalized = await sharp(output, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (normalized.format !== "png" || normalized.width !== WIDTH || normalized.height !== HEIGHT || (normalized.pages ?? 1) !== 1) {
      throw new VideoProviderError("visual_normalization_failed", "The scene visual could not be normalized safely.", false);
    }
    return new Uint8Array(output);
  } catch (error) {
    if (error instanceof VideoProviderError) throw error;
    throwIfAborted(signal);
    throw new VideoProviderError("visual_response_invalid", "Gemini returned invalid image data.", false);
  }
}

function validateRequest(request: VisualAssetGenerationRequest, maxConcurrency: number, timeoutMs: number): void {
  if (request.model !== MODEL) throw new VideoProviderError("model_unavailable", "The configured Gemini visual model is unsupported.", false);
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 4
    || !Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 240_000
    || !request.projectId.trim() || request.scenes.length < 1 || request.scenes.length > MAX_SCENES) {
    throw new VideoProviderError("invalid_request", "The visual generation request is invalid.", false);
  }
  const ids = new Set<string>();
  for (const [index, scene] of request.scenes.entries()) {
    if (!scene.id.trim() || scene.id.length > 128 || scene.sceneNumber !== index + 1 || ids.has(scene.id)) {
      throw new VideoProviderError("invalid_request", "The visual generation request is invalid.", false);
    }
    ids.add(scene.id);
    buildGeminiVisualPrompt(request.projectTitle, scene);
  }
}

export function createGeminiVisualProvider(options: GeminiVisualProviderOptions): VisualAssetProviderAdapter {
  const maximumOutputBytes = options.maximumOutputBytes ?? MAX_OUTPUT_IMAGE_BYTES;
  const maximumTotalOutputBytes = options.maximumTotalOutputBytes
    ?? Math.min(MAX_TOTAL_OUTPUT_BYTES, maximumOutputBytes * MAX_SCENES);
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1 || maximumOutputBytes > MAX_OUTPUT_IMAGE_BYTES) {
    throw new VideoProviderError("configuration_invalid", "The visual output size limit is invalid.", false);
  }
  if (!Number.isSafeInteger(maximumTotalOutputBytes) || maximumTotalOutputBytes < 1
    || maximumTotalOutputBytes > MAX_TOTAL_OUTPUT_BYTES) {
    throw new VideoProviderError("configuration_invalid", "The visual generation size limit is invalid.", false);
  }
  const client = options.client ?? createSdkClient(options.apiKey);
  const scheduleTimeout = options.timeoutScheduler ?? ((onTimeout, timeoutMs) => setTimeout(onTimeout, timeoutMs));
  const cancelTimeout = options.timeoutCanceller ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  return {
    descriptor: {
      id: "gemini",
      label: "Gemini visual provider",
      developmentOnly: false,
      capabilities: {
        formats: ["png"],
        maximumScenes: MAX_SCENES,
        maximumBytesPerAsset: maximumOutputBytes,
        maximumTotalBytes: maximumTotalOutputBytes,
      },
    },
    async generateVisualAssets(request) {
      validateRequest(request, options.maxConcurrency, options.timeoutMs);
      const controller = new AbortController();
      const abortFromRequest = () => controller.abort(request.signal?.reason
        ?? new VideoProviderError("cancelled", "Visual generation was cancelled.", true));
      request.signal?.addEventListener("abort", abortFromRequest, { once: true });
      if (request.signal?.aborted) abortFromRequest();
      const timeout = scheduleTimeout(() => controller.abort(
        new VideoProviderError("timeout", "Visual generation timed out.", true),
      ), options.timeoutMs);
      const results = new Array<VideoVisualAssetResult>(request.scenes.length);
      let nextIndex = 0;
      let firstFailure: VideoProviderError | null = null;
      try {
        const worker = async (): Promise<void> => {
          while (!firstFailure) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= request.scenes.length) return;
            const scene = request.scenes[index];
            try {
              throwIfAborted(controller.signal);
              await heartbeat(request);
              throwIfAborted(controller.signal);
              const response = await client.generateImage({
                model: request.model,
                prompt: buildGeminiVisualPrompt(request.projectTitle, scene),
                sceneId: scene.id,
                sceneNumber: scene.sceneNumber,
                signal: controller.signal,
              });
              throwIfAborted(controller.signal);
              await heartbeat(request);
              if (response.requestSceneId !== scene.id || response.requestSceneNumber !== scene.sceneNumber) {
                throw new VideoProviderError("visual_response_mismatch", "Gemini returned a visual for the wrong scene.", false);
              }
              const images = imageParts(response);
              if (images.length === 0) throw new VideoProviderError("visual_response_missing", "Gemini returned no scene image.", false);
              if (images.length !== 1) throw new VideoProviderError("visual_response_ambiguous", "Gemini returned multiple scene images.", false);
              const decoded = decodeImage(images[0]);
              const bytes = await normalizeImage(decoded.bytes, decoded.expectedFormat, maximumOutputBytes, controller.signal);
              await heartbeat(request);
              results[index] = {
                sceneId: scene.id,
                sceneNumber: scene.sceneNumber,
                bytes,
                format: "png",
                mimeType: "image/png",
                width: WIDTH,
                height: HEIGHT,
                contentSha256: createHash("sha256").update(bytes).digest("hex"),
                providerRequestId: providerRequestId(response.responseId),
              };
            } catch (error) {
              const failure = classifyProviderFailure(error, controller.signal);
              if (!firstFailure) firstFailure = failure;
              if (!controller.signal.aborted) controller.abort(failure);
            }
          }
        };
        await Promise.all(Array.from(
          { length: Math.min(options.maxConcurrency, request.scenes.length) },
          () => worker(),
        ));
        if (firstFailure) throw firstFailure;
        if (results.some((asset, index) => !asset || asset.sceneId !== request.scenes[index].id
          || asset.sceneNumber !== request.scenes[index].sceneNumber)) {
          throw new VideoProviderError("invalid_asset_set", "Gemini returned an incomplete scene visual set.", false);
        }
        const totalBytes = results.reduce((total, asset) => total + asset.bytes.byteLength, 0);
        if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumTotalOutputBytes) {
          throw new VideoProviderError("visual_set_oversized", "The normalized scene visual set is too large.", false);
        }
        return results;
      } finally {
        cancelTimeout(timeout);
        request.signal?.removeEventListener("abort", abortFromRequest);
      }
    },
  };
}

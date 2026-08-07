import "server-only";

import { NextResponse } from "next/server";
import { VideoProductionError } from "@/types/videoProduction";
import { VideoProviderError } from "@/services/providers/video/videoProviderTypes";
import type { CreatorVideoScene } from "@/types/videoProduction";
import { parseVideoSceneRequest, VideoSceneRequestValidationError } from "@/services/video/videoSceneRequestPolicy";

const MAX_BODY_BYTES = 256_000;

export async function readVideoRequestBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new VideoProductionError("invalid_request", "The video request body is too large.", false, 413);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      throw new VideoProductionError("invalid_request", "The video request body is too large.", false, 413);
    }
    body = JSON.parse(text);
  }
  catch (error) {
    if (error instanceof VideoProductionError) throw error;
    throw new VideoProductionError("invalid_request", "The video request body is invalid.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new VideoProductionError("invalid_request", "The video request body is invalid.");
  return body as Record<string, unknown>;
}

export function assertRequestKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new VideoProductionError("invalid_request", "The video request contains unsupported fields.");
  }
}

export function parseVideoScenes(body: Record<string, unknown>): CreatorVideoScene[] | undefined {
  try { return parseVideoSceneRequest(body.scenes) as CreatorVideoScene[] | undefined; }
  catch (error) {
    if (error instanceof VideoSceneRequestValidationError) throw new VideoProductionError("invalid_request", error.message);
    throw error;
  }
}

export function optionalRequestString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new VideoProductionError("invalid_request", `${field} is invalid.`);
  return value;
}

export function optionalRequestArray(body: Record<string, unknown>, field: string): unknown[] | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new VideoProductionError("invalid_request", `${field} is invalid.`);
  return value;
}

export function requestChoice<T extends string>(body: Record<string, unknown>, field: string, choices: readonly T[], fallback: T): T {
  const value = optionalRequestString(body, field);
  if (value === undefined) return fallback;
  if (!choices.includes(value as T)) throw new VideoProductionError("invalid_request", `${field} is invalid.`);
  return value as T;
}

export function videoApiError(error: unknown): NextResponse {
  if (error instanceof VideoProductionError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, { status: error.status });
  }
  if (error instanceof VideoProviderError) {
    const status = error.code === "provider_disabled" ? 503
      : error.code === "configuration_invalid" || error.code === "ffmpeg_unavailable" || error.code === "ffprobe_unavailable"
        || error.code === "visual_provider_unavailable" ? 503
        : error.code === "model_unavailable" || error.code === "provider_unsupported" ? 422
          : error.code === "visual_rate_limited" ? 429
            : error.code === "timeout" ? 504
            : error.code === "cancelled" ? 408
              : 500;
    return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, { status });
  }
  return NextResponse.json({ error: { code: "internal_error", message: "Video production failed.", retryable: true } }, { status: 500 });
}

import "server-only";

import { VideoProviderError } from "./videoProviderTypes";

export interface VisualProviderConfiguration {
  provider: "mock" | "gemini" | "disabled";
  model: string;
  fallbackProvider: "none";
  timeoutMs: number;
  maxConcurrency: number;
  apiKey: string | null;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? String(fallback));
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new VideoProviderError("configuration_invalid", `${name} is invalid.`);
  }
  return parsed;
}

export function getVisualProviderConfiguration(): VisualProviderConfiguration {
  const rawProvider = (process.env.CREATOROS_VISUAL_PROVIDER
    ?? (process.env.NODE_ENV === "development" ? "mock" : "disabled")).trim().toLowerCase();
  if (rawProvider !== "mock" && rawProvider !== "gemini" && rawProvider !== "disabled") {
    throw new VideoProviderError("provider_unsupported", "The configured visual provider is unsupported.");
  }
  if (rawProvider === "mock" && process.env.NODE_ENV === "production") {
    throw new VideoProviderError("mock_forbidden", "The development visual provider is unavailable in production.");
  }
  const fallback = (process.env.CREATOROS_VISUAL_FALLBACK_PROVIDER ?? "none").trim().toLowerCase();
  if (fallback !== "none") {
    throw new VideoProviderError("fallback_unsupported", "Automatic visual-provider fallback is disabled.");
  }
  const timeoutMs = boundedInteger("CREATOROS_VISUAL_REQUEST_TIMEOUT_MS", 120_000, 10_000, 240_000);
  const maxConcurrency = boundedInteger("CREATOROS_VISUAL_MAX_CONCURRENCY", 2, 1, 4);
  const defaultModel = rawProvider === "mock" ? "mock-visual-v1"
    : rawProvider === "gemini" ? "gemini-3.1-flash-image" : "disabled";
  const model = (process.env.CREATOROS_VISUAL_MODEL ?? defaultModel).trim();
  let apiKey: string | null = null;
  if (rawProvider === "gemini") {
    if (model !== "gemini-3.1-flash-image") {
      throw new VideoProviderError("model_unavailable", "The configured Gemini visual model is unsupported.");
    }
    const configuredKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "").trim();
    if (!configuredKey || configuredKey.includes("\0")) {
      throw new VideoProviderError("configuration_invalid", "Gemini visual generation is not configured.");
    }
    apiKey = configuredKey;
  }
  return { provider: rawProvider, model, fallbackProvider: "none", timeoutMs, maxConcurrency, apiKey };
}

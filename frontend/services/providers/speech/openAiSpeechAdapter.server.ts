import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import {
  APICallError,
  generateSpeech,
  LoadAPIKeyError,
  NoSpeechGeneratedError,
  NoSuchModelError,
  RetryError,
} from "ai";

import type { ConfiguredOpenAiSpeechModelId } from "../providerConfig.server";
import {
  SpeechProviderError,
  type ProviderModelDescriptor,
  type SpeechGenerationRequest,
  type SpeechGenerationResult,
  type SpeechProviderAdapter,
  type VoiceDescriptor,
} from "../providerTypes";

const OPENAI_PROVIDER_ID = "openai";
const MAX_SEGMENT_CHARACTERS = 4_096;
const OUTPUT_MIME_TYPE = "audio/pcm";
const OUTPUT_EXTENSION = "pcm";
const MAX_DIAGNOSTIC_MESSAGE_CHARACTERS = 400;
const MAX_DIAGNOSTIC_CAUSES = 6;

type NeutralVoiceId =
  | "creatoros-atlas"
  | "creatoros-ember"
  | "creatoros-harbor"
  | "creatoros-lumen";

type OpenAiVoiceId = "alloy" | "coral" | "onyx" | "nova";

const OPENAI_VOICE_IDS: Readonly<Record<NeutralVoiceId, OpenAiVoiceId>> = {
  "creatoros-atlas": "onyx",
  "creatoros-ember": "coral",
  "creatoros-harbor": "alloy",
  "creatoros-lumen": "nova",
};

const VOICES: readonly VoiceDescriptor[] = [
  {
    voiceId: "creatoros-atlas",
    displayName: "Atlas",
    description: "Grounded narration with a steady presence.",
    supportedLanguageCodes: ["en"],
    style: ["grounded", "steady"],
  },
  {
    voiceId: "creatoros-ember",
    displayName: "Ember",
    description: "Warm narration for conversational content.",
    supportedLanguageCodes: ["en"],
    style: ["warm", "conversational"],
  },
  {
    voiceId: "creatoros-harbor",
    displayName: "Harbor",
    description: "Balanced narration for general-purpose scripts.",
    supportedLanguageCodes: ["en"],
    style: ["balanced", "versatile"],
  },
  {
    voiceId: "creatoros-lumen",
    displayName: "Lumen",
    description: "Bright narration with an energetic delivery.",
    supportedLanguageCodes: ["en"],
    style: ["bright", "energetic"],
  },
];

function isNeutralVoiceId(value: string): value is NeutralVoiceId {
  return Object.hasOwn(OPENAI_VOICE_IDS, value);
}

function normalizeRequiredValue(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new SpeechProviderError(
      "invalid_request",
      `${fieldName} is required.`,
      { providerId: OPENAI_PROVIDER_ID },
    );
  }

  return normalizedValue;
}

function validateRequest(request: SpeechGenerationRequest): {
  readonly text: string;
  readonly voiceId: NeutralVoiceId;
} {
  normalizeRequiredValue(request.operationId, "operationId");

  if (request.textSegments.length === 0) {
    throw new SpeechProviderError(
      "invalid_request",
      "At least one text segment is required.",
      { providerId: OPENAI_PROVIDER_ID },
    );
  }

  for (const [index, segment] of request.textSegments.entries()) {
    if (!segment.trim()) {
      throw new SpeechProviderError(
        "invalid_request",
        `Text segment ${index + 1} must not be empty.`,
        { providerId: OPENAI_PROVIDER_ID },
      );
    }

    if (segment.length > MAX_SEGMENT_CHARACTERS) {
      throw new SpeechProviderError(
        "invalid_request",
        `Text segment ${index + 1} exceeds the ${MAX_SEGMENT_CHARACTERS}-character limit.`,
        { providerId: OPENAI_PROVIDER_ID },
      );
    }
  }

  if (request.textSegments.length > 1) {
    throw new SpeechProviderError(
      "multi_segment_unsupported",
      "Speech segments must be generated one at a time by audio orchestration.",
      { providerId: OPENAI_PROVIDER_ID },
    );
  }

  const voiceId = request.voiceId.trim();

  if (!isNeutralVoiceId(voiceId)) {
    throw new SpeechProviderError(
      "unsupported_voice",
      "The selected CreatorOS voice is not supported by this provider.",
      { providerId: OPENAI_PROVIDER_ID },
    );
  }

  return {
    text: request.textSegments[0],
    voiceId,
  };
}

function getProviderRequestIds(
  responses: readonly { readonly headers?: Record<string, string> }[],
): string[] {
  const requestIds = new Set<string>();

  for (const response of responses) {
    for (const [headerName, headerValue] of Object.entries(
      response.headers ?? {},
    )) {
      if (
        headerName.toLowerCase() === "x-request-id" ||
        headerName.toLowerCase() === "openai-request-id"
      ) {
        requestIds.add(headerValue);
      }
    }
  }

  return [...requestIds];
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

function isTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    (error instanceof Error && error.name === "TimeoutError")
  );
}

interface ProviderErrorSnapshot {
  readonly name: string;
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly message: string;
  readonly sdkRetryable?: boolean;
}

interface ClassifiedProviderFailure {
  readonly code:
    | "authentication_error"
    | "quota_unavailable"
    | "model_unavailable"
    | "invalid_request"
    | "rate_limited"
    | "provider_timeout"
    | "provider_unavailable"
    | "generation_failed"
    | "aborted";
  readonly message: string;
  readonly retryable: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readProperty(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function normalizeDiagnosticCode(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const normalizedValue = String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 100);

  return normalizedValue || undefined;
}

function normalizeHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

function sanitizeDiagnosticMessage(
  value: unknown,
  redactedValues: readonly string[],
): string {
  if (typeof value !== "string") {
    return "No provider message was available.";
  }

  let sanitizedValue = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(
      /([?&](?:access_token|api_key|key|token)=)[^&\s]+/gi,
      "$1[REDACTED]",
    );

  for (const redactedValue of redactedValues) {
    if (redactedValue.length >= 8) {
      sanitizedValue = sanitizedValue.replaceAll(
        redactedValue,
        "[REDACTED]",
      );
    }
  }

  sanitizedValue = sanitizedValue.trim();

  if (!sanitizedValue) {
    return "No provider message was available.";
  }

  return sanitizedValue.slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARACTERS);
}

function collectProviderErrors(error: unknown): unknown[] {
  const collected: unknown[] = [];
  const queued: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queued.length > 0 && collected.length < MAX_DIAGNOSTIC_CAUSES) {
    const candidate = queued.shift();

    if (candidate === undefined || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    collected.push(candidate);

    if (RetryError.isInstance(candidate)) {
      queued.unshift(candidate.lastError);

      for (const retryError of candidate.errors) {
        queued.push(retryError);
      }
    }

    const cause = readProperty(candidate, "cause");

    if (cause !== undefined) {
      queued.push(cause);
    }
  }

  return collected;
}

function snapshotProviderError(
  error: unknown,
  redactedValues: readonly string[],
): ProviderErrorSnapshot {
  const data = APICallError.isInstance(error)
    ? error.data
    : readProperty(error, "data");
  const dataError = readProperty(data, "error");
  const providerMessage =
    readProperty(dataError, "message") ??
    readProperty(data, "message") ??
    readProperty(error, "message");
  const errorName = readProperty(error, "name");
  const status =
    (APICallError.isInstance(error) ? error.statusCode : undefined) ??
    normalizeHttpStatus(readProperty(error, "statusCode")) ??
    normalizeHttpStatus(readProperty(error, "status"));
  const providerCode = normalizeDiagnosticCode(
    readProperty(dataError, "code") ??
      readProperty(data, "code") ??
      readProperty(error, "code"),
  );

  return {
    name: normalizeDiagnosticCode(errorName) ?? "UnknownError",
    httpStatus: status,
    providerCode,
    message: sanitizeDiagnosticMessage(providerMessage, redactedValues),
    sdkRetryable: APICallError.isInstance(error)
      ? error.isRetryable
      : undefined,
  };
}

function includesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function classifyProviderFailure(
  error: unknown,
  snapshots: readonly ProviderErrorSnapshot[],
  aborted: boolean,
  timedOut: boolean,
): ClassifiedProviderFailure {
  const diagnosticText = snapshots
    .flatMap((snapshot) => [
      snapshot.name,
      snapshot.providerCode ?? "",
      snapshot.message,
    ])
    .join(" ")
    .toLowerCase();
  const statuses = snapshots.flatMap((snapshot) =>
    snapshot.httpStatus === undefined ? [] : [snapshot.httpStatus],
  );

  if (
    timedOut ||
    isTimeoutError(error) ||
    includesAny(diagnosticText, ["timeouterror", "request deadline expired"])
  ) {
    return {
      code: "provider_timeout",
      message: "The speech provider request timed out.",
      retryable: true,
    };
  }

  if (
    aborted ||
    isAbortError(error) ||
    includesAny(diagnosticText, ["aborterror", "request aborted"])
  ) {
    return {
      code: "aborted",
      message: "Speech generation was cancelled.",
      retryable: false,
    };
  }

  if (
    LoadAPIKeyError.isInstance(error) ||
    statuses.includes(401) ||
    statuses.includes(403) ||
    includesAny(diagnosticText, [
      "invalid_api_key",
      "incorrect api key",
      "authentication_error",
      "invalid authentication",
      "unauthorized",
    ])
  ) {
    return {
      code: "authentication_error",
      message: "The OpenAI API key was rejected.",
      retryable: false,
    };
  }

  if (
    includesAny(diagnosticText, [
      "insufficient_quota",
      "billing_not_active",
      "billing hard limit",
      "billing limit",
      "credit balance",
      "exceeded your current quota",
      "quota exceeded",
    ])
  ) {
    return {
      code: "quota_unavailable",
      message: "OpenAI API billing or quota is unavailable.",
      retryable: false,
    };
  }

  if (
    statuses.includes(429) ||
    includesAny(diagnosticText, [
      "rate_limit_exceeded",
      "rate limit",
      "too many requests",
    ])
  ) {
    return {
      code: "rate_limited",
      message: "The speech provider rate limit was reached.",
      retryable: true,
    };
  }

  if (
    NoSuchModelError.isInstance(error) ||
    includesAny(diagnosticText, [
      "model_not_found",
      "unsupported_model",
      "model is unavailable",
      "model does not exist",
      "model is not supported",
      "does not have access to model",
    ])
  ) {
    return {
      code: "model_unavailable",
      message: "The configured speech model is unavailable.",
      retryable: false,
    };
  }

  if (
    NoSpeechGeneratedError.isInstance(error) ||
    statuses.some((status) => [400, 409, 415, 422].includes(status)) ||
    includesAny(diagnosticText, [
      "invalid_request_error",
      "invalid request",
      "invalid_value",
      "unsupported_parameter",
      "unsupported format",
    ])
  ) {
    return {
      code: "invalid_request",
      message: "The speech request format was rejected.",
      retryable: false,
    };
  }

  if (
    statuses.includes(408) ||
    statuses.includes(504) ||
    includesAny(diagnosticText, [
      "timeouterror",
      "etimedout",
      "connect_timeout",
      "headers_timeout",
      "request timed out",
      "request timeout",
    ])
  ) {
    return {
      code: "provider_unavailable",
      message: "The speech provider could not be reached.",
      retryable: true,
    };
  }

  if (
    statuses.some((status) => status >= 500) ||
    includesAny(diagnosticText, [
      "fetch failed",
      "networkerror",
      "econnrefused",
      "econnreset",
      "enotfound",
      "socket hang up",
      "und_err_",
    ])
  ) {
    return {
      code: "provider_unavailable",
      message: "The speech provider could not be reached.",
      retryable: true,
    };
  }

  return {
    code: "generation_failed",
    message: "Speech generation failed.",
    retryable:
      snapshots.find((snapshot) => snapshot.sdkRetryable !== undefined)
        ?.sdkRetryable ?? true,
  };
}

function logProviderDiagnostic(
  model: string,
  voiceId: NeutralVoiceId,
  snapshots: readonly ProviderErrorSnapshot[],
  failure: ClassifiedProviderFailure,
): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const providerError = snapshots.find(
    (snapshot) => snapshot.httpStatus !== undefined || snapshot.providerCode,
  ) ?? snapshots.at(-1);

  console.error("[CreatorOS speech provider failure]", {
    stage: "generateSpeech",
    provider: OPENAI_PROVIDER_ID,
    configuredModel: model,
    neutralVoiceId: voiceId,
    providerErrorName: providerError?.name ?? "UnknownError",
    httpStatus: providerError?.httpStatus,
    providerErrorCode: providerError?.providerCode,
    sanitizedMessage:
      providerError?.message ?? "No provider message was available.",
    retryable: failure.retryable,
    causeChain: snapshots.map((snapshot) => ({
      name: snapshot.name,
      httpStatus: snapshot.httpStatus,
      providerErrorCode: snapshot.providerCode,
      sanitizedMessage: snapshot.message,
    })),
  });
}

class OpenAiSpeechAdapter implements SpeechProviderAdapter {
  readonly metadata: ProviderModelDescriptor;

  constructor(private readonly modelId: ConfiguredOpenAiSpeechModelId) {
    this.metadata = {
      providerId: OPENAI_PROVIDER_ID,
      modelId,
      capability: "speech",
      displayName: `OpenAI ${modelId}`,
      operational: true,
      asynchronous: false,
    };
  }

  async listVoices(): Promise<readonly VoiceDescriptor[]> {
    return VOICES;
  }

  async generate(
    request: SpeechGenerationRequest,
  ): Promise<SpeechGenerationResult> {
    const { text, voiceId } = validateRequest(request);
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      if (process.env.NODE_ENV === "development") {
        console.error("[CreatorOS speech provider failure]", {
          stage: "configuration",
          provider: OPENAI_PROVIDER_ID,
          configuredModel: this.modelId,
          neutralVoiceId: voiceId,
          providerErrorName: "ConfigurationError",
          providerErrorCode: "missing_api_key",
          sanitizedMessage: "The speech provider API key is not configured.",
          retryable: false,
          causeChain: [],
        });
      }

      throw new SpeechProviderError(
        "authentication_error",
        "Speech generation is not configured on the server.",
        { providerId: OPENAI_PROVIDER_ID },
      );
    }

    if (request.abortSignal?.aborted) {
      throw new SpeechProviderError(
        "aborted",
        "Speech generation was cancelled.",
        { providerId: OPENAI_PROVIDER_ID },
      );
    }

    try {
      const openai = createOpenAI({ apiKey });
      const result = await generateSpeech({
        model: openai.speech(this.modelId),
        text,
        voice: OPENAI_VOICE_IDS[voiceId],
        outputFormat: OUTPUT_EXTENSION,
        abortSignal: request.abortSignal,
      });

      return {
        kind: "completed",
        audioBytes: result.audio.uint8Array,
        mimeType: OUTPUT_MIME_TYPE,
        extension: OUTPUT_EXTENSION,
        providerRequestIds: getProviderRequestIds(result.responses),
      };
    } catch (error: unknown) {
      if (error instanceof SpeechProviderError) {
        throw error;
      }

      const redactedValues = [apiKey, text];
      const snapshots = collectProviderErrors(error).map((providerError) =>
        snapshotProviderError(providerError, redactedValues),
      );
      const failure = classifyProviderFailure(
        error,
        snapshots,
        request.abortSignal?.aborted === true,
        isTimeoutError(request.abortSignal?.reason),
      );

      logProviderDiagnostic(this.modelId, voiceId, snapshots, failure);

      throw new SpeechProviderError(
        failure.code,
        failure.message,
        {
          providerId: OPENAI_PROVIDER_ID,
          retryable: failure.retryable,
        },
      );
    }
  }
}

export function createOpenAiSpeechAdapter(
  modelId: ConfiguredOpenAiSpeechModelId,
): SpeechProviderAdapter {
  return new OpenAiSpeechAdapter(modelId);
}

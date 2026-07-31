import "server-only";

import { SpeechProviderError } from "./providerTypes";

export const DEFAULT_SPEECH_PROVIDER_ID = "openai" as const;
export const DEFAULT_SPEECH_MODEL_ID = "tts-1" as const;
export const MOCK_SPEECH_PROVIDER_ID = "mock" as const;
export const DEFAULT_MOCK_SPEECH_MODEL_ID = "mock-pcm-v1" as const;
export const DEFAULT_SPEECH_REQUEST_TIMEOUT_MS = 240_000;
export const MIN_SPEECH_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_SPEECH_REQUEST_TIMEOUT_MS = 280_000;

const SUPPORTED_SPEECH_PROVIDER_IDS = [
  DEFAULT_SPEECH_PROVIDER_ID,
  MOCK_SPEECH_PROVIDER_ID,
] as const;
const SUPPORTED_OPENAI_SPEECH_MODEL_IDS = ["tts-1", "tts-1-hd"] as const;
const SUPPORTED_MOCK_SPEECH_MODEL_IDS = [DEFAULT_MOCK_SPEECH_MODEL_ID] as const;

export type ConfiguredSpeechProviderId =
  (typeof SUPPORTED_SPEECH_PROVIDER_IDS)[number];
export type ConfiguredOpenAiSpeechModelId =
  (typeof SUPPORTED_OPENAI_SPEECH_MODEL_IDS)[number];
export type ConfiguredMockSpeechModelId =
  (typeof SUPPORTED_MOCK_SPEECH_MODEL_IDS)[number];

interface BaseSpeechProviderConfiguration {
  readonly fallbackProviderId: ConfiguredSpeechProviderId | null;
  readonly fallbackActive: false;
}

export type SpeechProviderConfiguration =
  | (BaseSpeechProviderConfiguration & {
      readonly providerId: typeof DEFAULT_SPEECH_PROVIDER_ID;
      readonly modelId: ConfiguredOpenAiSpeechModelId;
    })
  | (BaseSpeechProviderConfiguration & {
      readonly providerId: typeof MOCK_SPEECH_PROVIDER_ID;
      readonly modelId: ConfiguredMockSpeechModelId;
    });

function readConfiguredValue(
  variableName: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) {
    throw new SpeechProviderError(
      "configuration_error",
      `${variableName} must not be empty when configured.`,
    );
  }

  return normalizedValue;
}

function isSupportedProviderId(
  value: string,
): value is ConfiguredSpeechProviderId {
  return (SUPPORTED_SPEECH_PROVIDER_IDS as readonly string[]).includes(value);
}

function isSupportedOpenAiModelId(
  value: string,
): value is ConfiguredOpenAiSpeechModelId {
  return (SUPPORTED_OPENAI_SPEECH_MODEL_IDS as readonly string[]).includes(value);
}

function isSupportedMockModelId(
  value: string,
): value is ConfiguredMockSpeechModelId {
  return (SUPPORTED_MOCK_SPEECH_MODEL_IDS as readonly string[]).includes(value);
}

function assertProviderAllowed(
  providerId: ConfiguredSpeechProviderId,
  variableName: string,
): void {
  if (
    providerId === MOCK_SPEECH_PROVIDER_ID &&
    process.env.NODE_ENV === "production"
  ) {
    throw new SpeechProviderError(
      "configuration_error",
      `${variableName} cannot select the mock speech provider in production.`,
      { providerId },
    );
  }
}

function normalizeProviderId(
  value: string | undefined,
  variableName: string,
  defaultValue?: ConfiguredSpeechProviderId,
): ConfiguredSpeechProviderId {
  const configuredValue = readConfiguredValue(variableName, value);
  const providerId = configuredValue ?? defaultValue;

  if (!providerId || !isSupportedProviderId(providerId)) {
    throw new SpeechProviderError(
      "configuration_error",
      `${variableName} contains an unsupported speech provider.`,
    );
  }

  assertProviderAllowed(providerId, variableName);
  return providerId;
}

function normalizeOpenAiModelId(
  value: string | undefined,
): ConfiguredOpenAiSpeechModelId {
  const configuredValue = readConfiguredValue(
    "CREATOROS_VOICE_MODEL",
    value,
  );
  const modelId = configuredValue ?? DEFAULT_SPEECH_MODEL_ID;

  if (isSupportedOpenAiModelId(modelId)) {
    return modelId;
  }

  throw new SpeechProviderError(
    "configuration_error",
    "CREATOROS_VOICE_MODEL contains an unsupported speech model.",
    { providerId: DEFAULT_SPEECH_PROVIDER_ID },
  );
}

function normalizeMockModelId(
  value: string | undefined,
): ConfiguredMockSpeechModelId {
  const configuredValue = readConfiguredValue(
    "CREATOROS_VOICE_MODEL",
    value,
  );
  const modelId = configuredValue ?? DEFAULT_MOCK_SPEECH_MODEL_ID;

  if (isSupportedMockModelId(modelId)) {
    return modelId;
  }

  throw new SpeechProviderError(
    "configuration_error",
    "CREATOROS_VOICE_MODEL contains an unsupported speech model.",
    { providerId: MOCK_SPEECH_PROVIDER_ID },
  );
}

export function getSpeechProviderConfiguration(): SpeechProviderConfiguration {
  const providerId = normalizeProviderId(
    process.env.CREATOROS_VOICE_PROVIDER,
    "CREATOROS_VOICE_PROVIDER",
    DEFAULT_SPEECH_PROVIDER_ID,
  );
  const configuredFallback = readConfiguredValue(
    "CREATOROS_VOICE_FALLBACK_PROVIDER",
    process.env.CREATOROS_VOICE_FALLBACK_PROVIDER,
  );
  const fallbackProviderId = configuredFallback && configuredFallback !== "none"
    ? normalizeProviderId(
        configuredFallback,
        "CREATOROS_VOICE_FALLBACK_PROVIDER",
      )
    : null;

  if (providerId === MOCK_SPEECH_PROVIDER_ID) {
    return {
      providerId,
      modelId: normalizeMockModelId(process.env.CREATOROS_VOICE_MODEL),
      fallbackProviderId,
      fallbackActive: false,
    };
  }

  return {
    providerId,
    modelId: normalizeOpenAiModelId(process.env.CREATOROS_VOICE_MODEL),
    fallbackProviderId,
    fallbackActive: false,
  };
}

export function getSpeechRequestTimeoutMs(): number {
  const configuredValue = process.env.CREATOROS_VOICE_REQUEST_TIMEOUT_MS;

  if (configuredValue === undefined) {
    return DEFAULT_SPEECH_REQUEST_TIMEOUT_MS;
  }

  const normalizedValue = configuredValue.trim();
  const timeoutMs = Number(normalizedValue);

  if (
    !/^\d+$/.test(normalizedValue) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_SPEECH_REQUEST_TIMEOUT_MS ||
    timeoutMs > MAX_SPEECH_REQUEST_TIMEOUT_MS
  ) {
    throw new SpeechProviderError(
      "configuration_error",
      `CREATOROS_VOICE_REQUEST_TIMEOUT_MS must be an integer from ${MIN_SPEECH_REQUEST_TIMEOUT_MS} to ${MAX_SPEECH_REQUEST_TIMEOUT_MS}.`,
    );
  }

  return timeoutMs;
}

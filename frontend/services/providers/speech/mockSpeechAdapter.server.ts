import "server-only";

import type { ConfiguredMockSpeechModelId } from "../providerConfig.server";
import {
  SpeechProviderError,
  type ProviderModelDescriptor,
  type SpeechGenerationRequest,
  type SpeechGenerationResult,
  type SpeechProviderAdapter,
  type VoiceDescriptor,
} from "../providerTypes";

const MOCK_PROVIDER_ID = "mock";
const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2;
const MAX_SEGMENT_CHARACTERS = 4_096;
const MIN_DURATION_SECONDS = 0.8;
const MAX_DURATION_SECONDS = 2;
const AMPLITUDE = Math.round(0x7fff * 0.12);

type NeutralVoiceId =
  | "creatoros-atlas"
  | "creatoros-ember"
  | "creatoros-harbor"
  | "creatoros-lumen";

interface MockVoiceDefinition {
  readonly descriptor: VoiceDescriptor;
  readonly frequencyHz: number;
}

const MOCK_VOICES: Readonly<Record<NeutralVoiceId, MockVoiceDefinition>> = {
  "creatoros-atlas": {
    descriptor: {
      voiceId: "creatoros-atlas",
      displayName: "Atlas",
      description: "Low test tone for local pipeline validation.",
      supportedLanguageCodes: ["en"],
      style: ["grounded", "steady"],
    },
    frequencyHz: 220,
  },
  "creatoros-ember": {
    descriptor: {
      voiceId: "creatoros-ember",
      displayName: "Ember",
      description: "Warm test tone for local pipeline validation.",
      supportedLanguageCodes: ["en"],
      style: ["warm", "conversational"],
    },
    frequencyHz: 262,
  },
  "creatoros-harbor": {
    descriptor: {
      voiceId: "creatoros-harbor",
      displayName: "Harbor",
      description: "Balanced test tone for local pipeline validation.",
      supportedLanguageCodes: ["en"],
      style: ["balanced", "versatile"],
    },
    frequencyHz: 294,
  },
  "creatoros-lumen": {
    descriptor: {
      voiceId: "creatoros-lumen",
      displayName: "Lumen",
      description: "Bright test tone for local pipeline validation.",
      supportedLanguageCodes: ["en"],
      style: ["bright", "energetic"],
    },
    frequencyHz: 330,
  },
};

const VOICES = Object.values(MOCK_VOICES).map(
  ({ descriptor }) => descriptor,
);

function assertMockProviderAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new SpeechProviderError(
      "configuration_error",
      "The mock speech provider is unavailable in production.",
      { providerId: MOCK_PROVIDER_ID },
    );
  }
}

function isNeutralVoiceId(value: string): value is NeutralVoiceId {
  return Object.hasOwn(MOCK_VOICES, value);
}

function normalizeRequiredValue(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new SpeechProviderError(
      "invalid_request",
      `${fieldName} is required.`,
      { providerId: MOCK_PROVIDER_ID },
    );
  }

  return normalizedValue;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SpeechProviderError(
      "aborted",
      "Speech generation was cancelled.",
      { providerId: MOCK_PROVIDER_ID },
    );
  }
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
      { providerId: MOCK_PROVIDER_ID },
    );
  }

  if (request.textSegments.length > 1) {
    throw new SpeechProviderError(
      "multi_segment_unsupported",
      "Speech segments must be generated one at a time by audio orchestration.",
      { providerId: MOCK_PROVIDER_ID },
    );
  }

  const text = request.textSegments[0];

  if (!text.trim()) {
    throw new SpeechProviderError(
      "invalid_request",
      "Text segment 1 must not be empty.",
      { providerId: MOCK_PROVIDER_ID },
    );
  }

  if (text.length > MAX_SEGMENT_CHARACTERS) {
    throw new SpeechProviderError(
      "invalid_request",
      `Text segment 1 exceeds the ${MAX_SEGMENT_CHARACTERS}-character limit.`,
      { providerId: MOCK_PROVIDER_ID },
    );
  }

  const voiceId = request.voiceId.trim();

  if (!isNeutralVoiceId(voiceId)) {
    throw new SpeechProviderError(
      "unsupported_voice",
      "The selected CreatorOS voice is not supported by this provider.",
      { providerId: MOCK_PROVIDER_ID },
    );
  }

  return { text, voiceId };
}

function getDurationSeconds(textLength: number): number {
  const durationRange = MAX_DURATION_SECONDS - MIN_DURATION_SECONDS;
  const lengthRatio = Math.min(textLength, MAX_SEGMENT_CHARACTERS) /
    MAX_SEGMENT_CHARACTERS;

  return MIN_DURATION_SECONDS + durationRange * lengthRatio;
}

function generateMockPcm(
  textLength: number,
  frequencyHz: number,
  abortSignal: AbortSignal | undefined,
): { readonly audioBytes: Uint8Array; readonly durationSeconds: number } {
  const requestedDuration = getDurationSeconds(textLength);
  const sampleCount = Math.max(
    1,
    Math.round(requestedDuration * SAMPLE_RATE),
  );
  const audioBytes = new Uint8Array(sampleCount * BYTES_PER_SAMPLE);
  const view = new DataView(audioBytes.buffer);
  const fadeSamples = Math.round(SAMPLE_RATE * 0.02);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    if (sampleIndex % 2_048 === 0) {
      throwIfAborted(abortSignal);
    }

    const elapsedSeconds = sampleIndex / SAMPLE_RATE;
    const fadeIn = Math.min(1, sampleIndex / fadeSamples);
    const fadeOut = Math.min(1, (sampleCount - sampleIndex - 1) / fadeSamples);
    const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
    const pulseLevel = Math.floor(elapsedSeconds / 0.2) % 2 === 0
      ? 1
      : 0.35;
    const sample = Math.round(
      Math.sin(2 * Math.PI * frequencyHz * elapsedSeconds) *
        AMPLITUDE *
        envelope *
        pulseLevel,
    );

    view.setInt16(sampleIndex * BYTES_PER_SAMPLE, sample, true);
  }

  throwIfAborted(abortSignal);

  return {
    audioBytes,
    durationSeconds: sampleCount / SAMPLE_RATE,
  };
}

class MockSpeechAdapter implements SpeechProviderAdapter {
  readonly metadata: ProviderModelDescriptor;

  constructor(modelId: ConfiguredMockSpeechModelId) {
    this.metadata = {
      providerId: MOCK_PROVIDER_ID,
      modelId,
      capability: "speech",
      displayName: "CreatorOS Mock PCM",
      operational: true,
      asynchronous: false,
    };
  }

  async listVoices(): Promise<readonly VoiceDescriptor[]> {
    assertMockProviderAllowed();
    return VOICES;
  }

  async generate(
    request: SpeechGenerationRequest,
  ): Promise<SpeechGenerationResult> {
    assertMockProviderAllowed();
    throwIfAborted(request.abortSignal);

    const { text, voiceId } = validateRequest(request);
    const { audioBytes, durationSeconds } = generateMockPcm(
      text.length,
      MOCK_VOICES[voiceId].frequencyHz,
      request.abortSignal,
    );

    return {
      kind: "completed",
      audioBytes,
      mimeType: "audio/pcm",
      extension: "pcm",
      durationSeconds,
      providerRequestIds: [
        `mock-pcm-${voiceId}-${audioBytes.byteLength}`,
      ],
    };
  }
}

export function createMockSpeechAdapter(
  modelId: ConfiguredMockSpeechModelId,
): SpeechProviderAdapter {
  assertMockProviderAllowed();
  return new MockSpeechAdapter(modelId);
}

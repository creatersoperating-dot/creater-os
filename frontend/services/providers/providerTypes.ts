export type ProviderCapability = "script" | "speech";

export interface ProviderModelDescriptor {
  readonly providerId: string;
  readonly modelId: string;
  readonly capability: ProviderCapability;
  readonly displayName: string;
  readonly operational: boolean;
  readonly asynchronous: boolean;
}

export interface VoiceDescriptor {
  readonly voiceId: string;
  readonly displayName: string;
  readonly description?: string;
  readonly supportedLanguageCodes: readonly string[];
  readonly gender?: "feminine" | "masculine" | "neutral";
  readonly style?: readonly string[];
}

export interface SpeechGenerationRequest {
  readonly textSegments: readonly string[];
  readonly voiceId: string;
  readonly operationId: string;
  readonly abortSignal?: AbortSignal;
}

export interface CompletedSpeechGenerationResult {
  readonly kind: "completed";
  readonly audioBytes: Uint8Array;
  readonly mimeType: string;
  readonly extension: string;
  readonly durationSeconds?: number;
  readonly providerRequestIds: readonly string[];
}

export interface PendingSpeechGenerationResult {
  readonly kind: "pending";
  readonly providerJobId: string;
  readonly pollingDelayMs?: number;
}

export type SpeechGenerationResult =
  | CompletedSpeechGenerationResult
  | PendingSpeechGenerationResult;

export interface SpeechProviderAdapter {
  readonly metadata: ProviderModelDescriptor;
  listVoices(): Promise<readonly VoiceDescriptor[]>;
  generate(request: SpeechGenerationRequest): Promise<SpeechGenerationResult>;
}

export type SpeechProviderErrorCode =
  | "configuration_error"
  | "authentication_error"
  | "quota_unavailable"
  | "model_unavailable"
  | "invalid_request"
  | "unsupported_voice"
  | "multi_segment_unsupported"
  | "rate_limited"
  | "provider_timeout"
  | "generation_failed"
  | "aborted"
  | "provider_unavailable";

export interface SpeechProviderErrorOptions {
  readonly providerId?: string;
  readonly retryable?: boolean;
}

export class SpeechProviderError extends Error {
  readonly code: SpeechProviderErrorCode;
  readonly providerId?: string;
  readonly retryable: boolean;

  constructor(
    code: SpeechProviderErrorCode,
    message: string,
    options: SpeechProviderErrorOptions = {},
  ) {
    super(message);
    this.name = "SpeechProviderError";
    this.code = code;
    this.providerId = options.providerId;
    this.retryable = options.retryable ?? false;
  }
}

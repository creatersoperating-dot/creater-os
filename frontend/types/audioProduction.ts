import type { CreatorVideoProject } from "./videoProject";

export const AUDIO_GENERATION_STATUSES = [
  "queued",
  "generating",
  "uploading",
  "ready",
  "failed",
  "cancelled",
] as const;

export type AudioGenerationStatus =
  (typeof AUDIO_GENERATION_STATUSES)[number];

export const AUDIO_ATTEMPT_STATUSES = [
  "generating",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AudioAttemptStatus =
  (typeof AUDIO_ATTEMPT_STATUSES)[number];

export const AUDIO_ACCESS_PURPOSES = ["playback", "download"] as const;

export type AudioAccessPurpose =
  (typeof AUDIO_ACCESS_PURPOSES)[number];

export interface CreatorVoiceDescriptor {
  voiceId: string;
  displayName: string;
  description: string | null;
  supportedLanguageCodes: readonly string[];
  style: readonly string[];
}

export interface CreatorAudioGeneration {
  id: string;
  brandId: string;
  projectId: string;
  sourceScriptId: string | null;
  operationId: string;
  status: AudioGenerationStatus;
  provider: string;
  model: string;
  voiceId: string;
  voiceLabel: string;
  sourceScriptUpdatedAt: string;
  sourceContentSha256: string;
  inputCharacters: number;
  segmentCount: number;
  storageBucket: string | null;
  storagePath: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  durationMs: number | null;
  providerJobId: string | null;
  providerRequestId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  cleanupPending: boolean;
  attemptCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface CreatorAudioGenerationAttempt {
  generationId: string;
  attemptNumber: number;
  provider: string;
  model: string;
  voiceId: string;
  status: AudioAttemptStatus;
  providerJobId: string | null;
  providerRequestIds: readonly string[];
  segmentsCompleted: number;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorAudioGenerationSummary {
  id: string;
  brandId: string;
  projectId: string;
  sourceScriptId: string | null;
  operationId: string;
  status: AudioGenerationStatus;
  voiceId: string;
  voiceLabel: string;
  sourceScriptUpdatedAt: string;
  inputCharacters: number;
  segmentCount: number;
  mimeType: string | null;
  fileSizeBytes: number | null;
  durationMs: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  failureRetryable: boolean;
  attemptCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface ProjectAudioGenerationHistory {
  project: CreatorVideoProject;
  attachedAudioGenerationId: string | null;
  generations: readonly CreatorAudioGenerationSummary[];
}

export interface AudioGenerationRequest {
  brandId: string;
  projectId: string;
  operationId: string;
  voiceId: string;
  signal?: AbortSignal;
}

export interface AudioFailureInformation {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ReadyAudioGenerationResult {
  kind: "ready";
  attached: true;
  generation: CreatorAudioGeneration;
  project: CreatorVideoProject;
}

export interface ConflictedAudioGenerationResult {
  kind: "conflict";
  attached: false;
  generation: CreatorAudioGeneration;
  project: CreatorVideoProject | null;
  failure: AudioFailureInformation;
}

export interface ProcessingAudioGenerationResult {
  kind: "processing";
  generation: CreatorAudioGeneration;
  pollingDelayMs?: number;
}

export interface FailedAudioGenerationResult {
  kind: "failed";
  generation: CreatorAudioGeneration | null;
  failure: AudioFailureInformation;
}

export type AudioGenerationLifecycleResult =
  | ReadyAudioGenerationResult
  | ConflictedAudioGenerationResult
  | ProcessingAudioGenerationResult
  | FailedAudioGenerationResult;

export interface PublicReadyAudioGenerationResult {
  kind: "ready";
  attached: true;
  generation: CreatorAudioGenerationSummary;
  project: CreatorVideoProject;
}

export interface PublicConflictedAudioGenerationResult {
  kind: "conflict";
  attached: false;
  generation: CreatorAudioGenerationSummary;
  project: CreatorVideoProject | null;
  failure: AudioFailureInformation;
}

export interface PublicProcessingAudioGenerationResult {
  kind: "processing";
  generation: CreatorAudioGenerationSummary;
  pollingDelayMs?: number;
}

export interface PublicFailedAudioGenerationResult {
  kind: "failed";
  generation: CreatorAudioGenerationSummary | null;
  failure: AudioFailureInformation;
}

export type PublicAudioGenerationLifecycleResult =
  | PublicReadyAudioGenerationResult
  | PublicConflictedAudioGenerationResult
  | PublicProcessingAudioGenerationResult
  | PublicFailedAudioGenerationResult;

export interface ReadyNarrationAttachmentResult {
  generation: CreatorAudioGenerationSummary;
  project: CreatorVideoProject;
}

export interface SecureAudioAccessMetadata {
  audioGenerationId: string;
  accessUrl: string;
  expiresAt: string;
  mimeType: string;
  filename: string;
  purpose: AudioAccessPurpose;
  fileSizeBytes: number;
  durationMs: number | null;
}

export class AudioProductionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "AudioProductionError";
    this.code = code;
    this.retryable = retryable;
  }
}

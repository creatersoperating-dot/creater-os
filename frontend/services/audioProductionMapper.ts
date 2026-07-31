import {
  AUDIO_ATTEMPT_STATUSES,
  AUDIO_GENERATION_STATUSES,
  type AudioGenerationLifecycleResult,
  type AudioAttemptStatus,
  type AudioGenerationStatus,
  type CreatorAudioGeneration,
  type CreatorAudioGenerationAttempt,
  type CreatorAudioGenerationSummary,
  type PublicAudioGenerationLifecycleResult,
} from "@/types/audioProduction";

const RETRYABLE_AUDIO_FAILURE_CODES = new Set([
  "cleanup_failed",
  "database_error",
  "generation_conflict",
  "generation_failed",
  "invalid_provider_audio",
  "provider_unavailable",
  "provider_timeout",
  "rate_limited",
  "upload_failed",
]);

export interface AudioGenerationRow {
  user_id: string;
  id: string;
  brand_id: string;
  project_id: string;
  source_script_id: string | null;
  operation_id: string;
  status: string;
  provider: string;
  model: string;
  voice_id: string;
  voice_label: string;
  source_script_updated_at: string;
  source_content_sha256: string;
  input_characters: number;
  segment_count: number;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  duration_ms: number | null;
  provider_job_id: string | null;
  provider_request_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  cleanup_pending: boolean;
  attempt_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface AudioGenerationAttemptRow {
  user_id: string;
  generation_id: string;
  attempt_number: number;
  provider: string;
  model: string;
  voice_id: string;
  status: string;
  provider_job_id: string | null;
  provider_request_ids: unknown;
  segments_completed: number;
  failure_code: string | null;
  failure_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Malformed authoritative audio row: ${fieldName}.`);
  }

  return value;
}

function requireNullableString(
  value: unknown,
  fieldName: string,
): string | null {
  return value === null ? null : requireNonEmptyString(value, fieldName);
}

function requireTimestamp(value: unknown, fieldName: string): string {
  const timestamp = requireNonEmptyString(value, fieldName);

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`Malformed authoritative audio row: ${fieldName}.`);
  }

  return timestamp;
}

function requireNullableTimestamp(
  value: unknown,
  fieldName: string,
): string | null {
  return value === null ? null : requireTimestamp(value, fieldName);
}

function requireNonnegativeInteger(
  value: unknown,
  fieldName: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`Malformed authoritative audio row: ${fieldName}.`);
  }

  return value;
}

function requireNullableNonnegativeInteger(
  value: unknown,
  fieldName: string,
): number | null {
  return value === null
    ? null
    : requireNonnegativeInteger(value, fieldName);
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Malformed authoritative audio row: ${fieldName}.`);
  }

  return value;
}

function requireGenerationStatus(value: unknown): AudioGenerationStatus {
  if (
    typeof value !== "string" ||
    !(AUDIO_GENERATION_STATUSES as readonly string[]).includes(value)
  ) {
    throw new Error("Malformed authoritative audio row: status.");
  }

  return value as AudioGenerationStatus;
}

function requireAttemptStatus(value: unknown): AudioAttemptStatus {
  if (
    typeof value !== "string" ||
    !(AUDIO_ATTEMPT_STATUSES as readonly string[]).includes(value)
  ) {
    throw new Error("Malformed authoritative audio attempt row: status.");
  }

  return value as AudioAttemptStatus;
}

function requireRequestIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "Malformed authoritative audio attempt row: provider_request_ids.",
    );
  }

  const requestIds: string[] = [];

  for (const requestId of value as unknown[]) {
    if (typeof requestId !== "string" || requestId.trim() === "") {
      throw new Error(
        "Malformed authoritative audio attempt row: provider_request_ids.",
      );
    }

    requestIds.push(requestId);
  }

  return requestIds;
}

export function mapAudioGenerationRowToGeneration(
  row: AudioGenerationRow,
): CreatorAudioGeneration {
  requireNonEmptyString(row.user_id, "user_id");
  const status = requireGenerationStatus(row.status);
  const sourceContentSha256 = requireNonEmptyString(
    row.source_content_sha256,
    "source_content_sha256",
  );

  if (!/^[0-9a-f]{64}$/.test(sourceContentSha256)) {
    throw new Error(
      "Malformed authoritative audio row: source_content_sha256.",
    );
  }

  const storageBucket = requireNullableString(
    row.storage_bucket,
    "storage_bucket",
  );
  const storagePath = requireNullableString(row.storage_path, "storage_path");
  const mimeType = requireNullableString(row.mime_type, "mime_type");
  const fileSizeBytes = requireNullableNonnegativeInteger(
    row.file_size_bytes,
    "file_size_bytes",
  );

  if (
    status === "ready" &&
    (storageBucket !== "project-audio" ||
      storagePath === null ||
      mimeType !== "audio/wav" ||
      fileSizeBytes === null)
  ) {
    throw new Error("Malformed authoritative ready audio row.");
  }

  return {
    id: requireNonEmptyString(row.id, "id"),
    brandId: requireNonEmptyString(row.brand_id, "brand_id"),
    projectId: requireNonEmptyString(row.project_id, "project_id"),
    sourceScriptId: requireNullableString(
      row.source_script_id,
      "source_script_id",
    ),
    operationId: requireNonEmptyString(row.operation_id, "operation_id"),
    status,
    provider: requireNonEmptyString(row.provider, "provider"),
    model: requireNonEmptyString(row.model, "model"),
    voiceId: requireNonEmptyString(row.voice_id, "voice_id"),
    voiceLabel: requireNonEmptyString(row.voice_label, "voice_label"),
    sourceScriptUpdatedAt: requireTimestamp(
      row.source_script_updated_at,
      "source_script_updated_at",
    ),
    sourceContentSha256,
    inputCharacters: requireNonnegativeInteger(
      row.input_characters,
      "input_characters",
    ),
    segmentCount: requireNonnegativeInteger(row.segment_count, "segment_count"),
    storageBucket,
    storagePath,
    mimeType,
    fileSizeBytes,
    durationMs: requireNullableNonnegativeInteger(
      row.duration_ms,
      "duration_ms",
    ),
    providerJobId: requireNullableString(
      row.provider_job_id,
      "provider_job_id",
    ),
    providerRequestId: requireNullableString(
      row.provider_request_id,
      "provider_request_id",
    ),
    failureCode: requireNullableString(row.failure_code, "failure_code"),
    failureMessage: requireNullableString(
      row.failure_message,
      "failure_message",
    ),
    cleanupPending: requireBoolean(
      row.cleanup_pending,
      "cleanup_pending",
    ),
    attemptCount: requireNonnegativeInteger(
      row.attempt_count,
      "attempt_count",
    ),
    createdAt: requireTimestamp(row.created_at, "created_at"),
    startedAt: requireNullableTimestamp(row.started_at, "started_at"),
    completedAt: requireNullableTimestamp(row.completed_at, "completed_at"),
    updatedAt: requireTimestamp(row.updated_at, "updated_at"),
  };
}

export function mapAudioGenerationAttemptRowToAttempt(
  row: AudioGenerationAttemptRow,
): CreatorAudioGenerationAttempt {
  requireNonEmptyString(row.user_id, "user_id");
  const status = requireAttemptStatus(row.status);
  const completedAt = requireNullableTimestamp(
    row.completed_at,
    "completed_at",
  );

  if (
    (status === "generating" && completedAt !== null) ||
    (status !== "generating" && completedAt === null)
  ) {
    throw new Error("Malformed authoritative audio attempt completion state.");
  }

  return {
    generationId: requireNonEmptyString(row.generation_id, "generation_id"),
    attemptNumber: requireNonnegativeInteger(
      row.attempt_number,
      "attempt_number",
    ),
    provider: requireNonEmptyString(row.provider, "provider"),
    model: requireNonEmptyString(row.model, "model"),
    voiceId: requireNonEmptyString(row.voice_id, "voice_id"),
    status,
    providerJobId: requireNullableString(
      row.provider_job_id,
      "provider_job_id",
    ),
    providerRequestIds: requireRequestIds(row.provider_request_ids),
    segmentsCompleted: requireNonnegativeInteger(
      row.segments_completed,
      "segments_completed",
    ),
    failureCode: requireNullableString(row.failure_code, "failure_code"),
    failureMessage: requireNullableString(
      row.failure_message,
      "failure_message",
    ),
    startedAt: requireTimestamp(row.started_at, "started_at"),
    completedAt,
    createdAt: requireTimestamp(row.created_at, "created_at"),
    updatedAt: requireTimestamp(row.updated_at, "updated_at"),
  };
}

export function mapAudioGenerationToSummary(
  generation: CreatorAudioGeneration,
): CreatorAudioGenerationSummary {
  return {
    id: generation.id,
    brandId: generation.brandId,
    projectId: generation.projectId,
    sourceScriptId: generation.sourceScriptId,
    operationId: generation.operationId,
    status: generation.status,
    voiceId: generation.voiceId,
    voiceLabel: generation.voiceLabel,
    sourceScriptUpdatedAt: generation.sourceScriptUpdatedAt,
    inputCharacters: generation.inputCharacters,
    segmentCount: generation.segmentCount,
    mimeType: generation.mimeType,
    fileSizeBytes: generation.fileSizeBytes,
    durationMs: generation.durationMs,
    failureCode: generation.failureCode,
    failureMessage: generation.failureMessage,
    failureRetryable:
      generation.status === "failed" &&
      generation.failureCode !== null &&
      RETRYABLE_AUDIO_FAILURE_CODES.has(generation.failureCode),
    attemptCount: generation.attemptCount,
    createdAt: generation.createdAt,
    startedAt: generation.startedAt,
    completedAt: generation.completedAt,
    updatedAt: generation.updatedAt,
  };
}

export function mapAudioGenerationLifecycleToPublic(
  result: AudioGenerationLifecycleResult,
): PublicAudioGenerationLifecycleResult {
  if (result.kind === "ready") {
    return {
      ...result,
      generation: mapAudioGenerationToSummary(result.generation),
    };
  }

  if (result.kind === "conflict") {
    return {
      ...result,
      generation: mapAudioGenerationToSummary(result.generation),
    };
  }

  if (result.kind === "processing") {
    return {
      ...result,
      generation: mapAudioGenerationToSummary(result.generation),
    };
  }

  return {
    ...result,
    generation: result.generation
      ? mapAudioGenerationToSummary(result.generation)
      : null,
  };
}

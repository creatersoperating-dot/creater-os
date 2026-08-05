"use client";

import {
  AUDIO_ACCESS_PURPOSES,
  AUDIO_GENERATION_STATUSES,
  type AudioAccessPurpose,
  type AudioFailureInformation,
  type CreatorAudioGenerationSummary,
  type CreatorVoiceDescriptor,
  type ProjectAudioGenerationHistory,
  type PublicAudioGenerationLifecycleResult,
  type ReadyNarrationAttachmentResult,
  type SecureAudioAccessMetadata,
} from "@/types/audioProduction";
import {
  VIDEO_PROJECT_STATUSES,
  type CreatorVideoProject,
  type VideoProjectStatus,
} from "@/types/videoProject";

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GenerateProjectNarrationInput {
  brandId: string;
  projectId: string;
  operationId: string;
  voiceId: string;
  signal?: AbortSignal;
}

export class CloudAudioProductionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    status: number,
    retryable = false,
  ) {
    super(message);
    this.name = "CloudAudioProductionError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requireObject(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (!isObject(value)) {
    throw new CloudAudioProductionError(
      "invalid_response",
      `The server returned an invalid ${description}.`,
      500,
    );
  }

  return value;
}

function requireString(
  value: unknown,
  description: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CloudAudioProductionError(
      "invalid_response",
      `The server returned an invalid ${description}.`,
      500,
    );
  }

  return value;
}

function requireNullableString(
  value: unknown,
  description: string,
): string | null {
  return value === null ? null : requireString(value, description);
}

function requireBoolean(
  value: unknown,
  description: string,
): boolean {
  if (typeof value !== "boolean") {
    throw new CloudAudioProductionError(
      "invalid_response",
      `The server returned an invalid ${description}.`,
      500,
    );
  }

  return value;
}

function requireNonnegativeInteger(
  value: unknown,
  description: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new CloudAudioProductionError(
      "invalid_response",
      `The server returned an invalid ${description}.`,
      500,
    );
  }

  return value;
}

function requireNullableNonnegativeInteger(
  value: unknown,
  description: string,
): number | null {
  return value === null
    ? null
    : requireNonnegativeInteger(value, description);
}

function requireTimestamp(
  value: unknown,
  description: string,
): string {
  const timestamp = requireString(value, description);

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new CloudAudioProductionError(
      "invalid_response",
      `The server returned an invalid ${description}.`,
      500,
    );
  }

  return timestamp;
}

function requireSecureUrl(
  value: unknown,
  description: string,
): string {
  const url = requireString(value, description);

  try {
    const parsedUrl = new URL(url);
    const isLocalDevelopmentUrl =
      parsedUrl.protocol === "http:" &&
      (parsedUrl.hostname === "localhost" ||
        parsedUrl.hostname === "127.0.0.1");

    if (parsedUrl.protocol !== "https:" && !isLocalDevelopmentUrl) {
      throw new Error("Secure URL required.");
    }
  } catch {
    throw new CloudAudioProductionError(
      "invalid_response",
      `The server returned an invalid ${description}.`,
      500,
    );
  }

  return url;
}

function requireNullableTimestamp(
  value: unknown,
  description: string,
): string | null {
  return value === null ? null : requireTimestamp(value, description);
}

function requireStringArray(
  value: unknown,
  description: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new CloudAudioProductionError(
      "invalid_response",
      `The server returned an invalid ${description}.`,
      500,
    );
  }

  return [...(value as string[])];
}

function requireVideoProjectStatus(value: unknown): VideoProjectStatus {
  if (
    typeof value !== "string" ||
    !(VIDEO_PROJECT_STATUSES as readonly string[]).includes(value)
  ) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned an invalid project status.",
      500,
    );
  }

  return value as VideoProjectStatus;
}

function parseProject(value: unknown): CreatorVideoProject {
  const project = requireObject(value, "project");

  return {
    id: requireString(project.id, "project ID"),
    brandId: requireString(project.brandId, "project brand ID"),
    scriptId: requireNullableString(
      project.scriptId,
      "project script ID",
    ),
    audioGenerationId: requireNullableString(
      project.audioGenerationId,
      "project audio generation ID",
    ),
    videoGenerationId: requireNullableString(
      project.videoGenerationId,
      "project video generation ID",
    ),
    title: requireString(project.title, "project title"),
    topic:
      typeof project.topic === "string"
        ? project.topic
        : requireString(project.topic, "project topic"),
    status: requireVideoProjectStatus(project.status),
    createdAt: requireTimestamp(project.createdAt, "project creation time"),
    updatedAt: requireTimestamp(project.updatedAt, "project update time"),
  };
}

function parseGeneration(
  value: unknown,
): CreatorAudioGenerationSummary {
  const generation = requireObject(value, "narration generation");
  const status = requireString(generation.status, "narration status");

  if (!(AUDIO_GENERATION_STATUSES as readonly string[]).includes(status)) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned an invalid narration status.",
      500,
    );
  }

  const parsedGeneration: CreatorAudioGenerationSummary = {
    id: requireString(generation.id, "narration ID"),
    brandId: requireString(generation.brandId, "narration brand ID"),
    projectId: requireString(
      generation.projectId,
      "narration project ID",
    ),
    sourceScriptId: requireNullableString(
      generation.sourceScriptId,
      "narration source script ID",
    ),
    operationId: requireString(
      generation.operationId,
      "narration operation ID",
    ),
    status: status as CreatorAudioGenerationSummary["status"],
    voiceId: requireString(generation.voiceId, "narration voice ID"),
    voiceLabel: requireString(
      generation.voiceLabel,
      "narration voice label",
    ),
    sourceScriptUpdatedAt: requireTimestamp(
      generation.sourceScriptUpdatedAt,
      "narration source timestamp",
    ),
    inputCharacters: requireNonnegativeInteger(
      generation.inputCharacters,
      "narration character count",
    ),
    segmentCount: requireNonnegativeInteger(
      generation.segmentCount,
      "narration segment count",
    ),
    mimeType: requireNullableString(
      generation.mimeType,
      "narration MIME type",
    ),
    fileSizeBytes: requireNullableNonnegativeInteger(
      generation.fileSizeBytes,
      "narration file size",
    ),
    durationMs: requireNullableNonnegativeInteger(
      generation.durationMs,
      "narration duration",
    ),
    failureCode: requireNullableString(
      generation.failureCode,
      "narration failure code",
    ),
    failureMessage: requireNullableString(
      generation.failureMessage,
      "narration failure message",
    ),
    failureRetryable: requireBoolean(
      generation.failureRetryable,
      "narration retry state",
    ),
    attemptCount: requireNonnegativeInteger(
      generation.attemptCount,
      "narration attempt count",
    ),
    createdAt: requireTimestamp(
      generation.createdAt,
      "narration creation time",
    ),
    startedAt: requireNullableTimestamp(
      generation.startedAt,
      "narration start time",
    ),
    completedAt: requireNullableTimestamp(
      generation.completedAt,
      "narration completion time",
    ),
    updatedAt: requireTimestamp(
      generation.updatedAt,
      "narration update time",
    ),
  };

  if (
    parsedGeneration.status === "ready" &&
    (parsedGeneration.mimeType !== "audio/wav" ||
      parsedGeneration.fileSizeBytes === null)
  ) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned incomplete ready narration metadata.",
      500,
    );
  }

  return parsedGeneration;
}

function requireGenerationScope(
  generation: CreatorAudioGenerationSummary,
  brandId: string,
  projectId: string,
): void {
  if (
    generation.brandId !== brandId ||
    generation.projectId !== projectId
  ) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned narration from a different project.",
      500,
    );
  }
}

function parseFailure(value: unknown): AudioFailureInformation {
  const failure = requireObject(value, "narration failure");

  return {
    code: requireString(failure.code, "failure code"),
    message: requireString(failure.message, "failure message"),
    retryable: requireBoolean(failure.retryable, "failure retry state"),
  };
}

function parseLifecycle(
  value: unknown,
): PublicAudioGenerationLifecycleResult {
  const result = requireObject(value, "narration lifecycle result");

  if (result.kind === "ready" && result.attached === true) {
    return {
      kind: "ready",
      attached: true,
      generation: parseGeneration(result.generation),
      project: parseProject(result.project),
    };
  }

  if (result.kind === "conflict" && result.attached === false) {
    return {
      kind: "conflict",
      attached: false,
      generation: parseGeneration(result.generation),
      project: result.project === null ? null : parseProject(result.project),
      failure: parseFailure(result.failure),
    };
  }

  if (result.kind === "processing") {
    const pollingDelayMs = result.pollingDelayMs;

    if (
      pollingDelayMs !== undefined &&
      (typeof pollingDelayMs !== "number" ||
        !Number.isSafeInteger(pollingDelayMs) ||
        pollingDelayMs < 0)
    ) {
      throw new CloudAudioProductionError(
        "invalid_response",
        "The server returned an invalid polling delay.",
        500,
      );
    }

    return {
      kind: "processing",
      generation: parseGeneration(result.generation),
      ...(pollingDelayMs === undefined ? {} : { pollingDelayMs }),
    };
  }

  if (result.kind === "failed") {
    return {
      kind: "failed",
      generation:
        result.generation === null
          ? null
          : parseGeneration(result.generation),
      failure: parseFailure(result.failure),
    };
  }

  throw new CloudAudioProductionError(
    "invalid_response",
    "The server returned an invalid narration lifecycle result.",
    500,
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned an unreadable response.",
      response.status || 500,
    );
  }
}

function getFallbackErrorMessage(status: number): string {
  if (status === 400) {
    return "The narration request was invalid.";
  }

  if (status === 401) {
    return "Authentication required.";
  }

  if (status === 404) {
    return "The requested narration resource was not found.";
  }

  if (status === 409) {
    return "The project changed before the narration request completed.";
  }

  if (status === 422) {
    return "The project is not ready for narration generation.";
  }

  return "The narration request could not be completed.";
}

function throwApiError(response: Response, value: unknown): never {
  const envelope = isObject(value) ? value.error : null;
  const error = isObject(envelope) ? envelope : null;
  const code =
    error && typeof error.code === "string"
      ? error.code
      : "audio_request_failed";
  const message =
    error && typeof error.message === "string" && error.message.trim()
      ? error.message
      : getFallbackErrorMessage(response.status);
  const retryable =
    error && typeof error.retryable === "boolean"
      ? error.retryable
      : false;

  throw new CloudAudioProductionError(
    code,
    message,
    response.status || 500,
    retryable,
  );
}

function normalizeRequiredId(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new CloudAudioProductionError(
      "invalid_request",
      `${fieldName} is required.`,
      400,
    );
  }

  return normalizedValue;
}

function projectAudioEndpoint(brandId: string, projectId: string): string {
  return `/api/brands/${encodeURIComponent(
    normalizeRequiredId(brandId, "brandId"),
  )}/projects/${encodeURIComponent(
    normalizeRequiredId(projectId, "projectId"),
  )}/audio-generations`;
}

export async function getConfiguredVoices(): Promise<
  readonly CreatorVoiceDescriptor[]
> {
  const response = await fetch("/api/audio/voices", {
    cache: "no-store",
  });
  const value = await readJson(response);

  if (!response.ok) {
    throwApiError(response, value);
  }

  const envelope = requireObject(value, "voice response");

  if (!Array.isArray(envelope.voices)) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned an invalid voice list.",
      500,
    );
  }

  return envelope.voices.map((item) => {
    const voice = requireObject(item, "voice");

    return {
      voiceId: requireString(voice.voiceId, "voice ID"),
      displayName: requireString(voice.displayName, "voice name"),
      description:
        voice.description === null
          ? null
          : requireString(voice.description, "voice description"),
      supportedLanguageCodes: requireStringArray(
        voice.supportedLanguageCodes,
        "voice language list",
      ),
      style: requireStringArray(voice.style, "voice style list"),
    };
  });
}

export async function getProjectAudioGenerations(
  brandId: string,
  projectId: string,
): Promise<ProjectAudioGenerationHistory> {
  const normalizedBrandId = normalizeRequiredId(brandId, "brandId");
  const normalizedProjectId = normalizeRequiredId(projectId, "projectId");
  const response = await fetch(projectAudioEndpoint(
    normalizedBrandId,
    normalizedProjectId,
  ), {
    cache: "no-store",
  });
  const value = await readJson(response);

  if (!response.ok) {
    throwApiError(response, value);
  }

  const history = requireObject(value, "narration history");

  if (!Array.isArray(history.generations)) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned an invalid narration history.",
      500,
    );
  }

  const parsedProject = parseProject(history.project);
  const attachedAudioGenerationId = requireNullableString(
      history.attachedAudioGenerationId,
      "attached narration ID",
    );
  const generations = history.generations.map(parseGeneration);

  if (
    parsedProject.brandId !== normalizedBrandId ||
    parsedProject.id !== normalizedProjectId ||
    parsedProject.audioGenerationId !== attachedAudioGenerationId
  ) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned narration history for a different project.",
      500,
    );
  }

  for (const generation of generations) {
    requireGenerationScope(
      generation,
      normalizedBrandId,
      normalizedProjectId,
    );
  }

  return {
    project: parsedProject,
    attachedAudioGenerationId,
    generations,
  };
}

export async function generateProjectNarration(
  input: GenerateProjectNarrationInput,
): Promise<PublicAudioGenerationLifecycleResult> {
  const brandId = normalizeRequiredId(input.brandId, "brandId");
  const projectId = normalizeRequiredId(input.projectId, "projectId");
  const operationId = normalizeRequiredId(
    input.operationId,
    "operationId",
  ).toLowerCase();

  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new CloudAudioProductionError(
      "invalid_operation_id",
      "operationId must be a valid UUID.",
      400,
    );
  }

  const response = await fetch(
    projectAudioEndpoint(brandId, projectId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId,
        voiceId: normalizeRequiredId(input.voiceId, "voiceId"),
      }),
      signal: input.signal,
    },
  );
  const value = await readJson(response);

  if (isObject(value) && typeof value.kind === "string") {
    const lifecycle = parseLifecycle(value);

    if (lifecycle.generation) {
      requireGenerationScope(lifecycle.generation, brandId, projectId);
    }

    if (
      (lifecycle.kind === "ready" || lifecycle.kind === "conflict") &&
      lifecycle.project &&
      (lifecycle.project.brandId !== brandId ||
        lifecycle.project.id !== projectId)
    ) {
      throw new CloudAudioProductionError(
        "invalid_response",
        "The server returned a lifecycle result for a different project.",
        500,
      );
    }

    return lifecycle;
  }

  if (!response.ok) {
    throwApiError(response, value);
  }

  return parseLifecycle(value);
}

export async function attachReadyNarration(
  brandId: string,
  projectId: string,
  audioGenerationId: string,
  expectedUpdatedAt: string,
): Promise<ReadyNarrationAttachmentResult> {
  const normalizedBrandId = normalizeRequiredId(brandId, "brandId");
  const normalizedProjectId = normalizeRequiredId(projectId, "projectId");
  const normalizedAudioGenerationId = normalizeRequiredId(
    audioGenerationId,
    "audioGenerationId",
  );
  const endpoint = `${projectAudioEndpoint(
    normalizedBrandId,
    normalizedProjectId,
  )}/${encodeURIComponent(
    normalizedAudioGenerationId,
  )}/attach`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedUpdatedAt: requireTimestamp(
        expectedUpdatedAt,
        "expected project timestamp",
      ),
    }),
  });
  const value = await readJson(response);

  if (!response.ok) {
    throwApiError(response, value);
  }

  const result = requireObject(value, "narration attachment");
  const parsedProject = parseProject(result.project);
  const generation = parseGeneration(result.generation);

  requireGenerationScope(
    generation,
    normalizedBrandId,
    normalizedProjectId,
  );

  if (
    generation.id !== normalizedAudioGenerationId ||
    parsedProject.brandId !== normalizedBrandId ||
    parsedProject.id !== normalizedProjectId ||
    parsedProject.audioGenerationId !== generation.id
  ) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned an invalid narration attachment.",
      500,
    );
  }

  return {
    project: parsedProject,
    generation,
  };
}

export async function getNarrationAccess(
  brandId: string,
  projectId: string,
  audioGenerationId: string,
  purpose: AudioAccessPurpose = "playback",
): Promise<SecureAudioAccessMetadata> {
  if (!(AUDIO_ACCESS_PURPOSES as readonly string[]).includes(purpose)) {
    throw new CloudAudioProductionError(
      "invalid_purpose",
      "purpose must be playback or download.",
      400,
    );
  }

  const normalizedBrandId = normalizeRequiredId(brandId, "brandId");
  const normalizedProjectId = normalizeRequiredId(projectId, "projectId");
  const normalizedAudioGenerationId = normalizeRequiredId(
    audioGenerationId,
    "audioGenerationId",
  );
  const endpoint = `${projectAudioEndpoint(
    normalizedBrandId,
    normalizedProjectId,
  )}/${encodeURIComponent(
    normalizedAudioGenerationId,
  )}/access?purpose=${encodeURIComponent(purpose)}`;
  const response = await fetch(endpoint, { cache: "no-store" });
  const value = await readJson(response);

  if (!response.ok) {
    throwApiError(response, value);
  }

  const access = requireObject(value, "narration access response");
  const returnedPurpose = requireString(
    access.purpose,
    "narration access purpose",
  );

  if (
    !(AUDIO_ACCESS_PURPOSES as readonly string[]).includes(returnedPurpose) ||
    returnedPurpose !== purpose
  ) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned an invalid narration access purpose.",
      500,
    );
  }

  const returnedAudioGenerationId = requireString(
      access.audioGenerationId,
      "narration access ID",
    );
  const filename = requireString(access.filename, "narration filename");
  const mimeType = requireString(access.mimeType, "narration MIME type");

  if (
    returnedAudioGenerationId !== normalizedAudioGenerationId ||
    mimeType !== "audio/wav" ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    throw new CloudAudioProductionError(
      "invalid_response",
      "The server returned invalid narration access metadata.",
      500,
    );
  }

  return {
    audioGenerationId: returnedAudioGenerationId,
    accessUrl: requireSecureUrl(
      access.accessUrl,
      "narration access URL",
    ),
    expiresAt: requireTimestamp(
      access.expiresAt,
      "narration access expiry",
    ),
    mimeType,
    filename,
    purpose: returnedPurpose as AudioAccessPurpose,
    fileSizeBytes: requireNonnegativeInteger(
      access.fileSizeBytes,
      "narration file size",
    ),
    durationMs: requireNullableNonnegativeInteger(
      access.durationMs,
      "narration duration",
    ),
  };
}

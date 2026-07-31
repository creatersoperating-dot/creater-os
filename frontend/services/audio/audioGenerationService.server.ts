import "server-only";

import {
  AudioProductionError,
  type AudioFailureInformation,
  type AudioGenerationLifecycleResult,
  type AudioGenerationRequest,
  type CreatorAudioGeneration,
} from "@/types/audioProduction";
import type { CreatorVideoProject } from "@/types/videoProject";
import { getSpeechProvider } from "@/services/providers/providerRegistry.server";
import { SpeechProviderError } from "@/services/providers/providerTypes";
import {
  createAuthenticatedAudioGenerationRepository,
  type AudioGenerationRepository,
  type CreateOrRecoverGenerationInput,
  type OwnedProjectWithScript,
} from "./audioGenerationRepository.server";
import { prepareNarrationText } from "./narrationText.server";
import { splitNarrationIntoSegments } from "./textChunking.server";
import { assemblePcmChunksToWav } from "./wavAssembly.server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new AudioProductionError(
      "invalid_request",
      `${fieldName} is required.`,
    );
  }

  return normalizedValue;
}

function normalizeOperationId(value: string): string {
  const operationId = normalizeRequiredText(value, "operationId").toLowerCase();

  if (!UUID_PATTERN.test(operationId)) {
    throw new AudioProductionError(
      "invalid_operation_id",
      "operationId must be a valid UUID.",
    );
  }

  return operationId;
}

function isTimeoutReason(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === "TimeoutError") ||
    (reason instanceof Error && reason.name === "TimeoutError")
  );
}

function getAbortFailure(signal: AbortSignal): AudioProductionError {
  if (isTimeoutReason(signal.reason)) {
    return new AudioProductionError(
      "provider_timeout",
      "The speech provider request timed out.",
      true,
    );
  }

  return new AudioProductionError(
    "cancelled",
    "Narration generation was cancelled.",
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw getAbortFailure(signal);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function toSafeFailure(
  error: unknown,
  signal?: AbortSignal,
): AudioFailureInformation {
  if (signal?.aborted && isTimeoutReason(signal.reason)) {
    const timeoutFailure = getAbortFailure(signal);
    return {
      code: timeoutFailure.code,
      message: timeoutFailure.message,
      retryable: timeoutFailure.retryable,
    };
  }

  if (error instanceof AudioProductionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof SpeechProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (isAbortError(error)) {
    return {
      code: "cancelled",
      message: "Narration generation was cancelled.",
      retryable: false,
    };
  }

  return {
    code: "generation_failed",
    message: "Narration generation failed.",
    retryable: true,
  };
}

function generationMatchesInput(
  generation: CreatorAudioGeneration,
  input: CreateOrRecoverGenerationInput,
): boolean {
  return (
    generation.brandId === input.brandId &&
    generation.projectId === input.projectId &&
    generation.sourceScriptId === input.sourceScript.id &&
    generation.operationId === input.operationId &&
    generation.provider === input.provider &&
    generation.model === input.model &&
    generation.voiceId === input.voiceId &&
    generation.voiceLabel === input.voiceLabel &&
    generation.sourceScriptUpdatedAt === input.sourceScript.updatedAt &&
    generation.sourceContentSha256 === input.sourceContentSha256 &&
    generation.inputCharacters === input.inputCharacters
  );
}

async function loadLatestProject(
  repository: AudioGenerationRepository,
  brandId: string,
  projectId: string,
): Promise<CreatorVideoProject | null> {
  try {
    return (
      await repository.loadOwnedProjectWithScript(brandId, projectId)
    )?.project ?? null;
  } catch {
    return null;
  }
}

async function attachReadyGeneration(
  repository: AudioGenerationRepository,
  context: OwnedProjectWithScript,
  generation: CreatorAudioGeneration,
  expectedProjectUpdatedAt: string,
): Promise<AudioGenerationLifecycleResult> {
  if (context.audioGenerationId === generation.id) {
    return {
      kind: "ready",
      attached: true,
      generation,
      project: context.project,
    };
  }

  try {
    const attachment = await repository.attachReadyGeneration(
      context.project.brandId,
      context.project.id,
      generation.id,
      expectedProjectUpdatedAt,
    );

    if (attachment.project) {
      return {
        kind: "ready",
        attached: true,
        generation: attachment.generation,
        project: attachment.project,
      };
    }

    return {
      kind: "conflict",
      attached: false,
      generation: attachment.generation,
      project: await loadLatestProject(
        repository,
        context.project.brandId,
        context.project.id,
      ),
      failure: {
        code: "attachment_conflict",
        message:
          "Narration was saved but was not attached because the project changed.",
        retryable: false,
      },
    };
  } catch (error: unknown) {
    return {
      kind: "conflict",
      attached: false,
      generation,
      project: await loadLatestProject(
        repository,
        context.project.brandId,
        context.project.id,
      ),
      failure: toSafeFailure(error),
    };
  }
}

export async function generateProjectNarration(
  request: AudioGenerationRequest,
): Promise<AudioGenerationLifecycleResult> {
  let repository: AudioGenerationRepository | null = null;
  let generation: CreatorAudioGeneration | null = null;
  let attemptNumber: number | null = null;

  try {
    const brandId = normalizeRequiredText(request.brandId, "brandId");
    const projectId = normalizeRequiredText(request.projectId, "projectId");
    const operationId = normalizeOperationId(request.operationId);
    const voiceId = normalizeRequiredText(request.voiceId, "voiceId");
    throwIfAborted(request.signal);

    repository = await createAuthenticatedAudioGenerationRepository();
    const context = await repository.loadOwnedProjectWithScript(
      brandId,
      projectId,
    );

    if (!context) {
      throw new AudioProductionError(
        "project_not_found",
        "The video project was not found.",
      );
    }

    if (!context.script) {
      throw new AudioProductionError(
        "script_required",
        "Attach a saved script before generating narration.",
      );
    }

    const capture = {
      projectId: context.project.id,
      projectUpdatedAt: context.project.updatedAt,
      projectStatus: context.project.status,
      scriptId: context.script.id,
      scriptUpdatedAt: context.script.updatedAt,
    } as const;
    const narration = prepareNarrationText(context.script.content);
    const segments = splitNarrationIntoSegments(narration.text);
    const provider = getSpeechProvider();
    const voices = await provider.listVoices();
    const voice = voices.find((candidate) => candidate.voiceId === voiceId);

    if (!voice) {
      throw new AudioProductionError(
        "unsupported_voice",
        "The selected CreatorOS voice is not available.",
      );
    }

    const generationInput: CreateOrRecoverGenerationInput = {
      brandId,
      projectId: capture.projectId,
      sourceScript: context.script,
      operationId,
      provider: provider.metadata.providerId,
      model: provider.metadata.modelId,
      voiceId,
      voiceLabel: voice.displayName,
      sourceContentSha256: narration.sourceContentSha256,
      inputCharacters: narration.inputCharacters,
    };
    const reservation =
      await repository.createOrRecoverGeneration(generationInput);
    generation = reservation.generation;

    if (reservation.kind === "active_generation") {
      return {
        kind: "processing",
        generation,
      };
    }

    if (!generationMatchesInput(generation, generationInput)) {
      return {
        kind: "conflict",
        attached: false,
        generation,
        project: context.project,
        failure: {
          code: "operation_conflict",
          message:
            "This operation ID already belongs to different narration input.",
          retryable: false,
        },
      };
    }

    if (generation.status === "ready") {
      return attachReadyGeneration(
        repository,
        context,
        generation,
        capture.projectUpdatedAt,
      );
    }

    if (
      generation.status === "generating" ||
      generation.status === "uploading"
    ) {
      return {
        kind: "processing",
        generation,
      };
    }

    if (generation.status === "cancelled") {
      return {
        kind: "failed",
        generation,
        failure: {
          code: "cancelled",
          message:
            "This narration operation was cancelled. Start a new operation to regenerate it.",
          retryable: false,
        },
      };
    }

    const claimResult = await repository.claimGeneration(generation);

    if (claimResult.kind === "active_generation") {
      return {
        kind: "processing",
        generation: claimResult.generation,
      };
    }

    if (claimResult.kind === "changed") {
      const latestGeneration = await repository.getGenerationById(
        generation.id,
      );

      if (!latestGeneration) {
        throw new AudioProductionError(
          "generation_conflict",
          "Narration generation state changed unexpectedly.",
          true,
        );
      }

      generation = latestGeneration;

      if (generation.status === "ready") {
        return attachReadyGeneration(
          repository,
          context,
          generation,
          capture.projectUpdatedAt,
        );
      }

      return {
        kind: "processing",
        generation,
      };
    }

    const claim = claimResult.claim;
    generation = claim.generation;
    attemptNumber = claim.attemptNumber;
    await repository.createAttempt(generation, attemptNumber);

    const pcmChunks: Uint8Array[] = [];
    const providerRequestIds: string[] = [];

    for (const [index, segment] of segments.entries()) {
      throwIfAborted(request.signal);
      const speechResult = await provider.generate({
        textSegments: [segment],
        voiceId,
        operationId,
        abortSignal: request.signal,
      });

      if (speechResult.kind === "pending") {
        const pendingGeneration = await repository.markProviderPending(
          generation,
          attemptNumber,
          speechResult.providerJobId,
        );

        return {
          kind: "processing",
          generation: pendingGeneration,
          pollingDelayMs: speechResult.pollingDelayMs,
        };
      }

      if (
        speechResult.mimeType !== "audio/pcm" ||
        speechResult.extension !== "pcm" ||
        speechResult.audioBytes.byteLength === 0 ||
        speechResult.audioBytes.byteLength % 2 !== 0
      ) {
        throw new AudioProductionError(
          "invalid_provider_audio",
          "The speech provider returned invalid PCM audio.",
          true,
        );
      }

      pcmChunks.push(speechResult.audioBytes);
      for (const requestId of speechResult.providerRequestIds) {
        if (!providerRequestIds.includes(requestId)) {
          providerRequestIds.push(requestId);
        }
      }

      await repository.updateAttemptProgress(
        generation.id,
        attemptNumber,
        index + 1,
        providerRequestIds,
      );
    }

    throwIfAborted(request.signal);
    const wav = assemblePcmChunksToWav(pcmChunks);
    const storagePath = repository.buildStoragePath(
      brandId,
      capture.projectId,
      generation.id,
    );
    generation = await repository.markUploading(
      generation,
      storagePath,
      segments.length,
      providerRequestIds,
    );
    generation = await repository.uploadAndFinalize({
      generation,
      attemptNumber,
      storagePath,
      wavBytes: wav.wavBytes,
      fileSizeBytes: wav.fileSizeBytes,
      durationMs: wav.durationMs,
      segmentCount: segments.length,
      providerRequestIds,
    });

    return attachReadyGeneration(
      repository,
      context,
      generation,
      capture.projectUpdatedAt,
    );
  } catch (error: unknown) {
    const failure = toSafeFailure(error, request.signal);
    const cancelled =
      failure.code === "cancelled" || failure.code === "aborted";

    if (repository && generation) {
      generation = await repository.recordFailure(
        generation,
        attemptNumber,
        failure,
        cancelled,
      );
    }

    return {
      kind: "failed",
      generation,
      failure,
    };
  }
}

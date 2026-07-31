import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  type AudioGenerationAttemptRow,
  type AudioGenerationRow,
  mapAudioGenerationAttemptRowToAttempt,
  mapAudioGenerationRowToGeneration,
} from "@/services/audioProductionMapper";
import {
  type ScriptRow,
  mapScriptRowToScript,
} from "@/services/scriptMapper";
import {
  type VideoProjectRow,
  mapVideoProjectRowToProject,
} from "@/services/videoProjectMapper";
import {
  AudioProductionError,
  type AudioAccessPurpose,
  type AudioFailureInformation,
  type CreatorAudioGeneration,
  type CreatorAudioGenerationAttempt,
  type SecureAudioAccessMetadata,
} from "@/types/audioProduction";
import type { CreatorScript } from "@/types/script";
import type { CreatorVideoProject } from "@/types/videoProject";

const AUDIO_BUCKET = "project-audio";
const AUDIO_MIME_TYPE = "audio/wav";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface OwnedProjectWithScript {
  readonly project: CreatorVideoProject;
  readonly audioGenerationId: string | null;
  readonly script: CreatorScript | null;
}

export interface OwnedProjectAudioHistory {
  readonly project: CreatorVideoProject;
  readonly generations: readonly CreatorAudioGeneration[];
}

export interface CreateOrRecoverGenerationInput {
  readonly brandId: string;
  readonly projectId: string;
  readonly sourceScript: CreatorScript;
  readonly operationId: string;
  readonly provider: string;
  readonly model: string;
  readonly voiceId: string;
  readonly voiceLabel: string;
  readonly sourceContentSha256: string;
  readonly inputCharacters: number;
}

export interface ClaimedGeneration {
  readonly generation: CreatorAudioGeneration;
  readonly attemptNumber: number;
}

export type GenerationReservationResult =
  | {
      readonly kind: "operation";
      readonly generation: CreatorAudioGeneration;
    }
  | {
      readonly kind: "active_generation";
      readonly generation: CreatorAudioGeneration;
    };

export type GenerationClaimResult =
  | {
      readonly kind: "claimed";
      readonly claim: ClaimedGeneration;
    }
  | {
      readonly kind: "active_generation";
      readonly generation: CreatorAudioGeneration;
    }
  | { readonly kind: "changed" };

export interface FinalizeUploadedGenerationInput {
  readonly generation: CreatorAudioGeneration;
  readonly attemptNumber: number;
  readonly storagePath: string;
  readonly wavBytes: Uint8Array;
  readonly fileSizeBytes: number;
  readonly durationMs: number;
  readonly segmentCount: number;
  readonly providerRequestIds: readonly string[];
}

export interface GuardedAttachmentResult {
  readonly generation: CreatorAudioGeneration;
  readonly project: CreatorVideoProject | null;
}

interface AudioGenerationInsertRow {
  user_id: string;
  id: string;
  brand_id: string;
  project_id: string;
  source_script_id: string;
  operation_id: string;
  status: "queued";
  provider: string;
  model: string;
  voice_id: string;
  voice_label: string;
  source_script_updated_at: string;
  source_content_sha256: string;
  input_characters: number;
  segment_count: number;
  attempt_count: number;
}

interface AudioAttemptInsertRow {
  user_id: string;
  generation_id: string;
  attempt_number: number;
  provider: string;
  model: string;
  voice_id: string;
  status: "generating";
  provider_request_ids: readonly string[];
  segments_completed: number;
  started_at: string;
}

function getErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;
}

function databaseError(message: string, retryable = true): AudioProductionError {
  return new AudioProductionError("database_error", message, retryable);
}

function getSafeErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) {
    return error.name.slice(0, 100);
  }

  return "UnknownError";
}

function warnCleanupPending(
  stage: "object_delete" | "cleanup_state_persistence",
  failureMode: "returned_error" | "thrown_error",
  error: unknown,
): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.warn("[CreatorOS narration cleanup pending]", {
    stage,
    bucket: AUDIO_BUCKET,
    failureMode,
    errorName: getSafeErrorName(error),
    cleanupPending: true,
  });
}

function mapGeneration(row: AudioGenerationRow): CreatorAudioGeneration {
  try {
    return mapAudioGenerationRowToGeneration(row);
  } catch {
    throw databaseError("Stored narration metadata is invalid.", false);
  }
}

function mapAttempt(
  row: AudioGenerationAttemptRow,
): CreatorAudioGenerationAttempt {
  try {
    return mapAudioGenerationAttemptRowToAttempt(row);
  } catch {
    throw databaseError("Stored narration attempt metadata is invalid.", false);
  }
}

function sanitizeFailure(
  failure: AudioFailureInformation,
): AudioFailureInformation {
  const code = failure.code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  const message = failure.message
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 1_000);

  return {
    code: code || "generation_failed",
    message: message || "Narration generation failed.",
    retryable: failure.retryable,
  };
}

export class AudioGenerationRepository {
  private constructor(
    private readonly supabase: SupabaseServerClient,
    private readonly userId: string,
  ) {}

  static async createAuthenticated(): Promise<AudioGenerationRepository> {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new AudioProductionError(
        "authentication_required",
        "Authentication required.",
      );
    }

    return new AudioGenerationRepository(supabase, user.id);
  }

  async loadOwnedProjectWithScript(
    brandId: string,
    projectId: string,
  ): Promise<OwnedProjectWithScript | null> {
    const { data: projectData, error: projectError } = await this.supabase
      .from("video_projects")
      .select("*")
      .eq("user_id", this.userId)
      .eq("brand_id", brandId)
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      throw databaseError("Unable to load the video project.");
    }

    if (!projectData) {
      return null;
    }

    const projectRow = projectData as VideoProjectRow;
    const project = mapVideoProjectRowToProject(projectRow);

    if (!project.scriptId) {
      return {
        project,
        audioGenerationId: projectRow.audio_generation_id,
        script: null,
      };
    }

    const { data: scriptData, error: scriptError } = await this.supabase
      .from("scripts")
      .select("*")
      .eq("user_id", this.userId)
      .eq("brand_id", brandId)
      .eq("id", project.scriptId)
      .maybeSingle();

    if (scriptError) {
      throw databaseError("Unable to load the attached script.");
    }

    return {
      project,
      audioGenerationId: projectRow.audio_generation_id,
      script: scriptData
        ? mapScriptRowToScript(scriptData as ScriptRow)
        : null,
    };
  }

  async getGenerationByOperation(
    brandId: string,
    projectId: string,
    operationId: string,
  ): Promise<CreatorAudioGeneration | null> {
    const { data, error } = await this.supabase
      .from("audio_generations")
      .select("*")
      .eq("user_id", this.userId)
      .eq("brand_id", brandId)
      .eq("project_id", projectId)
      .eq("operation_id", operationId)
      .maybeSingle();

    if (error) {
      throw databaseError("Unable to load narration generation state.");
    }

    return data ? mapGeneration(data as AudioGenerationRow) : null;
  }

  async getActiveGenerationForProject(
    brandId: string,
    projectId: string,
  ): Promise<CreatorAudioGeneration | null> {
    const { data, error } = await this.supabase
      .from("audio_generations")
      .select("*")
      .eq("user_id", this.userId)
      .eq("brand_id", brandId)
      .eq("project_id", projectId)
      .in("status", ["queued", "generating", "uploading"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw databaseError("Unable to load active narration generation state.");
    }

    return data ? mapGeneration(data as AudioGenerationRow) : null;
  }

  async getGenerationById(
    generationId: string,
  ): Promise<CreatorAudioGeneration | null> {
    const { data, error } = await this.supabase
      .from("audio_generations")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", generationId)
      .maybeSingle();

    if (error) {
      throw databaseError("Unable to load narration generation state.");
    }

    return data ? mapGeneration(data as AudioGenerationRow) : null;
  }

  async getGenerationForProject(
    brandId: string,
    projectId: string,
    generationId: string,
  ): Promise<CreatorAudioGeneration | null> {
    const { data, error } = await this.supabase
      .from("audio_generations")
      .select("*")
      .eq("user_id", this.userId)
      .eq("brand_id", brandId)
      .eq("project_id", projectId)
      .eq("id", generationId)
      .maybeSingle();

    if (error) {
      throw databaseError("Unable to load narration generation state.");
    }

    return data ? mapGeneration(data as AudioGenerationRow) : null;
  }

  async listProjectGenerations(
    brandId: string,
    projectId: string,
    limit = 20,
  ): Promise<OwnedProjectAudioHistory | null> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new AudioProductionError(
        "invalid_history_limit",
        "The narration history limit is invalid.",
      );
    }

    const context = await this.loadOwnedProjectWithScript(
      brandId,
      projectId,
    );

    if (!context) {
      return null;
    }

    const { data, error } = await this.supabase
      .from("audio_generations")
      .select("*")
      .eq("user_id", this.userId)
      .eq("brand_id", brandId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw databaseError("Unable to load narration history.");
    }

    const generations = ((data ?? []) as AudioGenerationRow[]).map(
      mapGeneration,
    );
    const attachedGenerationId = context.project.audioGenerationId;

    if (
      attachedGenerationId &&
      !generations.some(
        (generation) => generation.id === attachedGenerationId,
      )
    ) {
      const attachedGeneration = await this.getGenerationForProject(
        brandId,
        projectId,
        attachedGenerationId,
      );

      if (attachedGeneration) {
        generations.push(attachedGeneration);
        generations.sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt),
        );
      }
    }

    return {
      project: context.project,
      generations,
    };
  }

  async createReadyGenerationAccess(
    brandId: string,
    projectId: string,
    generationId: string,
    purpose: AudioAccessPurpose,
    expiresInSeconds: number,
  ): Promise<SecureAudioAccessMetadata | null> {
    if (
      !Number.isSafeInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > 3_600
    ) {
      throw new AudioProductionError(
        "invalid_access_lifetime",
        "The narration access lifetime is invalid.",
      );
    }

    const generation = await this.getGenerationForProject(
      brandId,
      projectId,
      generationId,
    );
    const expectedStoragePath = this.buildStoragePath(
      brandId,
      projectId,
      generationId,
    );

    if (
      !generation ||
      generation.status !== "ready" ||
      generation.storageBucket !== AUDIO_BUCKET ||
      generation.storagePath !== expectedStoragePath ||
      generation.mimeType !== AUDIO_MIME_TYPE ||
      generation.fileSizeBytes === null
    ) {
      return null;
    }

    const filename = "creatoros-narration.wav";
    const { data, error } = await this.supabase.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(
        expectedStoragePath,
        expiresInSeconds,
        purpose === "download" ? { download: filename } : undefined,
      );

    if (error || !data?.signedUrl) {
      throw new AudioProductionError(
        "access_failed",
        "Secure narration access could not be created.",
        true,
      );
    }

    return {
      audioGenerationId: generation.id,
      accessUrl: data.signedUrl,
      expiresAt: new Date(
        Date.now() + expiresInSeconds * 1_000,
      ).toISOString(),
      mimeType: generation.mimeType,
      filename,
      purpose,
      fileSizeBytes: generation.fileSizeBytes,
      durationMs: generation.durationMs,
    };
  }

  async createOrRecoverGeneration(
    input: CreateOrRecoverGenerationInput,
  ): Promise<GenerationReservationResult> {
    const existing = await this.getGenerationByOperation(
      input.brandId,
      input.projectId,
      input.operationId,
    );

    if (existing) {
      return { kind: "operation", generation: existing };
    }

    const row: AudioGenerationInsertRow = {
      user_id: this.userId,
      id: crypto.randomUUID(),
      brand_id: input.brandId,
      project_id: input.projectId,
      source_script_id: input.sourceScript.id,
      operation_id: input.operationId,
      status: "queued",
      provider: input.provider,
      model: input.model,
      voice_id: input.voiceId,
      voice_label: input.voiceLabel,
      source_script_updated_at: input.sourceScript.updatedAt,
      source_content_sha256: input.sourceContentSha256,
      input_characters: input.inputCharacters,
      segment_count: 0,
      attempt_count: 0,
    };
    const { data, error } = await this.supabase
      .from("audio_generations")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      if (getErrorCode(error) === "23505") {
        const recovered = await this.getGenerationByOperation(
          input.brandId,
          input.projectId,
          input.operationId,
        );

        if (recovered) {
          return { kind: "operation", generation: recovered };
        }

        const activeGeneration = await this.getActiveGenerationForProject(
          input.brandId,
          input.projectId,
        );

        if (activeGeneration) {
          return {
            kind: "active_generation",
            generation: activeGeneration,
          };
        }
      }

      throw databaseError("Unable to create narration generation state.");
    }

    return {
      kind: "operation",
      generation: mapGeneration(data as AudioGenerationRow),
    };
  }

  async claimGeneration(
    generation: CreatorAudioGeneration,
  ): Promise<GenerationClaimResult> {
    if (generation.status !== "queued" && generation.status !== "failed") {
      return { kind: "changed" };
    }

    if (generation.status === "failed" && generation.storagePath) {
      const { error: cleanupError } = await this.supabase.storage
        .from(AUDIO_BUCKET)
        .remove([generation.storagePath]);

      if (cleanupError) {
        throw new AudioProductionError(
          "cleanup_failed",
          "The previous failed narration upload could not be cleaned up.",
          true,
        );
      }
    }

    const attemptNumber = generation.attemptCount + 1;
    const { data, error } = await this.supabase
      .from("audio_generations")
      .update({
        status: "generating",
        attempt_count: attemptNumber,
        started_at: new Date().toISOString(),
        completed_at: null,
        provider_job_id: null,
        provider_request_id: null,
        storage_bucket: null,
        storage_path: null,
        mime_type: null,
        file_size_bytes: null,
        duration_ms: null,
        segment_count: 0,
        failure_code: null,
        failure_message: null,
        cleanup_pending: false,
      })
      .eq("user_id", this.userId)
      .eq("id", generation.id)
      .eq("status", generation.status)
      .eq("attempt_count", generation.attemptCount)
      .select("*")
      .maybeSingle();

    if (error) {
      if (getErrorCode(error) === "23505") {
        const activeGeneration = await this.getActiveGenerationForProject(
          generation.brandId,
          generation.projectId,
        );

        if (activeGeneration && activeGeneration.id !== generation.id) {
          return {
            kind: "active_generation",
            generation: activeGeneration,
          };
        }
      }

      throw databaseError("Unable to claim narration generation.");
    }

    return data
      ? {
          kind: "claimed",
          claim: {
          generation: mapGeneration(data as AudioGenerationRow),
          attemptNumber,
          },
        }
      : { kind: "changed" };
  }

  async createAttempt(
    generation: CreatorAudioGeneration,
    attemptNumber: number,
  ): Promise<CreatorAudioGenerationAttempt> {
    const row: AudioAttemptInsertRow = {
      user_id: this.userId,
      generation_id: generation.id,
      attempt_number: attemptNumber,
      provider: generation.provider,
      model: generation.model,
      voice_id: generation.voiceId,
      status: "generating",
      provider_request_ids: [],
      segments_completed: 0,
      started_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from("audio_generation_attempts")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      throw databaseError("Unable to create narration attempt history.");
    }

    return mapAttempt(data as AudioGenerationAttemptRow);
  }

  async updateAttemptProgress(
    generationId: string,
    attemptNumber: number,
    segmentsCompleted: number,
    providerRequestIds: readonly string[],
  ): Promise<CreatorAudioGenerationAttempt> {
    const { data, error } = await this.supabase
      .from("audio_generation_attempts")
      .update({
        segments_completed: segmentsCompleted,
        provider_request_ids: providerRequestIds,
      })
      .eq("user_id", this.userId)
      .eq("generation_id", generationId)
      .eq("attempt_number", attemptNumber)
      .eq("status", "generating")
      .select("*")
      .maybeSingle();

    if (error || !data) {
      throw databaseError("Unable to update narration attempt progress.");
    }

    return mapAttempt(data as AudioGenerationAttemptRow);
  }

  async markProviderPending(
    generation: CreatorAudioGeneration,
    attemptNumber: number,
    providerJobId: string,
  ): Promise<CreatorAudioGeneration> {
    const { data: generationData, error: generationError } = await this.supabase
      .from("audio_generations")
      .update({ provider_job_id: providerJobId })
      .eq("user_id", this.userId)
      .eq("id", generation.id)
      .eq("status", "generating")
      .select("*")
      .maybeSingle();

    if (generationError || !generationData) {
      throw databaseError("Unable to save pending narration state.");
    }

    const { error: attemptError } = await this.supabase
      .from("audio_generation_attempts")
      .update({ provider_job_id: providerJobId })
      .eq("user_id", this.userId)
      .eq("generation_id", generation.id)
      .eq("attempt_number", attemptNumber)
      .eq("status", "generating");

    if (attemptError) {
      throw databaseError("Unable to save pending narration attempt state.");
    }

    return mapGeneration(generationData as AudioGenerationRow);
  }

  buildStoragePath(
    brandId: string,
    projectId: string,
    generationId: string,
  ): string {
    return `${this.userId}/${brandId}/${projectId}/${generationId}/narration.wav`;
  }

  async markUploading(
    generation: CreatorAudioGeneration,
    storagePath: string,
    segmentCount: number,
    providerRequestIds: readonly string[],
  ): Promise<CreatorAudioGeneration> {
    const { data, error } = await this.supabase
      .from("audio_generations")
      .update({
        status: "uploading",
        storage_bucket: AUDIO_BUCKET,
        storage_path: storagePath,
        mime_type: AUDIO_MIME_TYPE,
        segment_count: segmentCount,
        provider_request_id: providerRequestIds[0] ?? null,
        cleanup_pending: false,
      })
      .eq("user_id", this.userId)
      .eq("id", generation.id)
      .eq("status", "generating")
      .eq("attempt_count", generation.attemptCount)
      .select("*")
      .maybeSingle();

    if (error || !data) {
      throw databaseError("Unable to prepare narration upload state.");
    }

    return mapGeneration(data as AudioGenerationRow);
  }

  private async uploadWav(
    storagePath: string,
    wavBytes: Uint8Array,
  ): Promise<void> {
    const { error } = await this.supabase.storage
      .from(AUDIO_BUCKET)
      .upload(storagePath, wavBytes, {
        contentType: AUDIO_MIME_TYPE,
        upsert: false,
      });

    if (error) {
      throw new AudioProductionError(
        "upload_failed",
        "Narration audio could not be uploaded.",
        true,
      );
    }
  }

  private async deleteUploadedObjectBestEffort(
    storagePath: string,
  ): Promise<boolean> {
    try {
      const { error } = await this.supabase.storage
        .from(AUDIO_BUCKET)
        .remove([storagePath]);

      if (error) {
        warnCleanupPending("object_delete", "returned_error", error);
        return false;
      }

      return true;
    } catch (error: unknown) {
      warnCleanupPending("object_delete", "thrown_error", error);
      return false;
    }
  }

  private async markCleanupPending(generationId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from("audio_generations")
        .update({ cleanup_pending: true })
        .eq("user_id", this.userId)
        .eq("id", generationId)
        .neq("status", "ready");

      if (error) {
        warnCleanupPending(
          "cleanup_state_persistence",
          "returned_error",
          error,
        );
      }
    } catch (error: unknown) {
      warnCleanupPending(
        "cleanup_state_persistence",
        "thrown_error",
        error,
      );
    }
  }

  private async completeAttempt(
    generationId: string,
    attemptNumber: number,
    segmentCount: number,
    providerRequestIds: readonly string[],
  ): Promise<CreatorAudioGenerationAttempt> {
    const { data, error } = await this.supabase
      .from("audio_generation_attempts")
      .update({
        status: "completed",
        segments_completed: segmentCount,
        provider_request_ids: providerRequestIds,
        completed_at: new Date().toISOString(),
        failure_code: null,
        failure_message: null,
      })
      .eq("user_id", this.userId)
      .eq("generation_id", generationId)
      .eq("attempt_number", attemptNumber)
      .eq("status", "generating")
      .select("*")
      .maybeSingle();

    if (error || !data) {
      throw databaseError("Unable to complete narration attempt history.");
    }

    return mapAttempt(data as AudioGenerationAttemptRow);
  }

  private async markReady(
    input: FinalizeUploadedGenerationInput,
  ): Promise<CreatorAudioGeneration> {
    const { data, error } = await this.supabase
      .from("audio_generations")
      .update({
        status: "ready",
        storage_bucket: AUDIO_BUCKET,
        storage_path: input.storagePath,
        mime_type: AUDIO_MIME_TYPE,
        file_size_bytes: input.fileSizeBytes,
        duration_ms: input.durationMs,
        segment_count: input.segmentCount,
        provider_request_id: input.providerRequestIds[0] ?? null,
        completed_at: new Date().toISOString(),
        failure_code: null,
        failure_message: null,
        cleanup_pending: false,
      })
      .eq("user_id", this.userId)
      .eq("id", input.generation.id)
      .eq("status", "uploading")
      .eq("attempt_count", input.attemptNumber)
      .select("*")
      .maybeSingle();

    if (error || !data) {
      throw databaseError("Unable to finalize narration metadata.");
    }

    return mapGeneration(data as AudioGenerationRow);
  }

  async uploadAndFinalize(
    input: FinalizeUploadedGenerationInput,
  ): Promise<CreatorAudioGeneration> {
    try {
      await this.uploadWav(input.storagePath, input.wavBytes);
      await this.completeAttempt(
        input.generation.id,
        input.attemptNumber,
        input.segmentCount,
        input.providerRequestIds,
      );
      return await this.markReady(input);
    } catch (error: unknown) {
      const wasDeleted = await this.deleteUploadedObjectBestEffort(
        input.storagePath,
      );

      if (!wasDeleted) {
        await this.markCleanupPending(input.generation.id);
      }

      throw error;
    }
  }

  async recordFailure(
    generation: CreatorAudioGeneration,
    attemptNumber: number | null,
    failure: AudioFailureInformation,
    cancelled: boolean,
  ): Promise<CreatorAudioGeneration> {
    const safeFailure = sanitizeFailure(failure);
    const terminalStatus = cancelled ? "cancelled" : "failed";
    const completedAt = new Date().toISOString();

    if (attemptNumber !== null) {
      try {
        await this.supabase
          .from("audio_generation_attempts")
          .update({
            status: terminalStatus,
            failure_code: safeFailure.code,
            failure_message: safeFailure.message,
            completed_at: completedAt,
          })
          .eq("user_id", this.userId)
          .eq("generation_id", generation.id)
          .eq("attempt_number", attemptNumber)
          .in("status", ["generating", "completed"]);
      } catch {
        // Preserve the original safe failure for the caller.
      }
    }

    try {
      const { data } = await this.supabase
        .from("audio_generations")
        .update({
          status: terminalStatus,
          failure_code: safeFailure.code,
          failure_message: safeFailure.message,
          completed_at: completedAt,
        })
        .eq("user_id", this.userId)
        .eq("id", generation.id)
        .in("status", ["queued", "generating", "uploading", "failed"])
        .select("*")
        .maybeSingle();

      if (data) {
        return mapGeneration(data as AudioGenerationRow);
      }
    } catch {
      // Fall through to the last authoritative state available to this worker.
    }

    try {
      return (await this.getGenerationById(generation.id)) ?? generation;
    } catch {
      return generation;
    }
  }

  async attachReadyGeneration(
    brandId: string,
    projectId: string,
    generationId: string,
    expectedProjectUpdatedAt: string,
  ): Promise<GuardedAttachmentResult> {
    const { data, error } = await this.supabase.rpc(
      "attach_ready_audio_generation",
      {
        p_brand_id: brandId,
        p_project_id: projectId,
        p_audio_generation_id: generationId,
        p_expected_project_updated_at: expectedProjectUpdatedAt,
      },
    );
    const generation = await this.getGenerationById(generationId);

    if (!generation) {
      throw databaseError("Ready narration metadata is unavailable.", false);
    }

    if (error) {
      const errorCode = getErrorCode(error);

      if (errorCode === "23503" || errorCode === "23514") {
        throw new AudioProductionError(
          "attachment_conflict",
          "Narration is ready but was not attached because the project or script changed.",
        );
      }

      throw databaseError("Unable to attach the ready narration.");
    }

    const rows = (data ?? []) as VideoProjectRow[];
    return {
      generation,
      project: rows[0] ? mapVideoProjectRowToProject(rows[0]) : null,
    };
  }
}

export async function createAuthenticatedAudioGenerationRepository(): Promise<AudioGenerationRepository> {
  return AudioGenerationRepository.createAuthenticated();
}

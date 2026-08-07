import "server-only";

import { createHash } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import type { AudioGenerationRow } from "@/services/audioProductionMapper";
import { mapScriptRowToScript, type ScriptRow } from "@/services/scriptMapper";
import { validateMp4 } from "@/services/video/mp4Validation.server";
import { assertAuthoritativeNarrationSize } from "@/services/video/audioRenderInputPolicy.server";
import { isExactAuthoritativeAssetSet } from "@/services/video/videoAssetSetPolicy";
import { CREATOROS_MAX_VIDEO_DURATION_MS, evaluateVideoDurationEligibility, isCompletedVideoDurationValid } from "@/services/video/videoDurationContract";
import { buildDeterministicScenes } from "@/services/video/videoScenePlanning.server";
import { canonicalVideoSceneSource } from "@/services/video/videoSceneSourceHash";
import { removePrivateStorageObject } from "@/services/video/videoStorageCleanup.server";
import { cleanupPartialVisualAssetUploads, reuseOrGenerateVisualAssets } from "@/services/video/visualAssetLifecycle.server";
import { videoVisualAssetStoragePath } from "@/services/video/videoVisualAssetStoragePath";
import {
  VideoProviderError,
  type ConfiguredVisualAssetProvider,
  type ConfiguredVideoRenderer,
  type VideoVisualAssetResult,
  type VideoRenderRequest,
  type VideoRenderVisualAssetInput,
} from "@/services/providers/video/videoProviderTypes";
import {
  mapVideoGeneration,
  mapVideoScenePlan,
  type VideoGenerationRow,
  type VideoSceneItemRow,
  type VideoScenePlanRow,
} from "@/services/videoProductionMapper";
import { mapVideoProjectRowToProject, type VideoProjectRow } from "@/services/videoProjectMapper";
import type { CreatorScript } from "@/types/script";
import type { CreatorVideoProject } from "@/types/videoProject";
import {
  VideoProductionError,
  type CreatorVideoScene,
  type CreatorVideoScenePlan,
  type SecureVideoAccess,
  type VideoHistoryResponse,
  type VideoLifecycleResponse,
} from "@/types/videoProduction";

const BUCKET = "project-videos";
const MAX_BYTES = 200 * 1024 * 1024;
const ACTIVE_STATUSES = ["queued", "planning", "generating_assets", "rendering", "uploading"] as const;
type ServerClient = Awaited<ReturnType<typeof createClient>>;

interface Context { project: CreatorVideoProject; script: CreatorScript; audio: AudioGenerationRow }
interface StorageEntry { name: string; metadata?: Record<string, unknown> | null }
interface VisualAssetRow {
  id: string; status: "queued" | "generating" | "uploading" | "ready" | "failed";
  scene_plan_id: string; scene_id: string; scene_number: number; format: "svg" | "png" | null;
  mime_type: "image/svg+xml" | "image/png" | null; width: number | null; height: number | null;
  file_size_bytes: number | null; content_sha256: string | null; storage_bucket: string;
  storage_path: string; cleanup_pending: boolean;
  source_scene_sha256: string;
  source_scene_plan_version: number;
  provider_request_id: string | null;
  provider: string;
  model: string;
}
interface ClaimedGenerationRow { generation_id: string; recovered: boolean; recovery_message: string | null }
interface StoredPathRow { storage_bucket: string | null; storage_path: string | null }

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new VideoProductionError("invalid_request", `${field} is required.`);
  return normalized;
}
function requiredUuid(value: string, field: string): string {
  const normalized = required(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new VideoProductionError("invalid_request", `${field} is invalid.`);
  }
  return normalized;
}
function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function storagePath(userId: string, brandId: string, projectId: string, generationId: string): string {
  return `${userId}/${brandId}/${projectId}/${generationId}/render.mp4`;
}
function safeFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof VideoProviderError || error instanceof VideoProductionError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: "generation_failed", message: "Video generation failed.", retryable: true };
}
function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof VideoProductionError || signal.reason instanceof VideoProviderError) throw signal.reason;
  throw new VideoProductionError("cancelled", "Video generation was cancelled.", true, 408);
}
function safeLog(label: string, details: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "development") console.warn(label, details);
}
function numericMetadata(metadata: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metadata?.[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export class VideoProductionService {
  private constructor(private readonly db: ServerClient, private readonly userId: string) {}

  static async authenticated(): Promise<VideoProductionService> {
    const db = await createClient();
    const { data: { user }, error } = await db.auth.getUser();
    if (error || !user) throw new VideoProductionError("authentication_required", "Authentication required.", false, 401);
    return new VideoProductionService(db, user.id);
  }

  private async loadProject(brandId: string, projectId: string, signal?: AbortSignal): Promise<CreatorVideoProject> {
    throwIfAborted(signal);
    const { data, error } = await this.db.from("video_projects").select("*")
      .eq("user_id", this.userId).eq("brand_id", brandId).eq("id", projectId).maybeSingle();
    throwIfAborted(signal);
    if (error) throw new VideoProductionError("database_error", "Unable to load the video project.", true, 500);
    if (!data) throw new VideoProductionError("not_found", "Video project not found.", false, 404);
    if ((data as { deletion_state?: string }).deletion_state === "cleaning") {
      throw new VideoProductionError("project_deleting", "The video project is being deleted.", true, 409);
    }
    return mapVideoProjectRowToProject(data as VideoProjectRow);
  }

  private async context(brandId: string, projectId: string, signal?: AbortSignal): Promise<Context> {
    const project = await this.loadProject(brandId, projectId, signal);
    if (!project.scriptId || !project.audioGenerationId) throw new VideoProductionError("prerequisites_missing", "Attach a script and ready narration before producing video.");
    throwIfAborted(signal);
    const [{ data: scriptRow, error: scriptError }, { data: audioRow, error: audioError }] = await Promise.all([
      this.db.from("scripts").select("*").eq("user_id", this.userId).eq("brand_id", brandId).eq("id", project.scriptId).maybeSingle(),
      this.db.from("audio_generations").select("*").eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId).eq("id", project.audioGenerationId).eq("status", "ready").maybeSingle(),
    ]);
    throwIfAborted(signal);
    if (scriptError || audioError) throw new VideoProductionError("database_error", "Unable to load video source material.", true, 500);
    if (!scriptRow || !audioRow) throw new VideoProductionError("stale_sources", "The current script or narration is unavailable.");
    const audio = audioRow as AudioGenerationRow;
    const script = mapScriptRowToScript(scriptRow as ScriptRow);
    if (audio.source_script_id !== script.id || audio.source_script_updated_at !== script.updatedAt || audio.source_content_sha256 !== hash(script.content) || audio.duration_ms === null || !audio.storage_path) {
      throw new VideoProductionError("stale_sources", "The attached narration is stale. Generate narration again.");
    }
    return { project, script, audio };
  }

  private async loadPlan(brandId: string, projectId: string, signal?: AbortSignal): Promise<CreatorVideoScenePlan | null> {
    throwIfAborted(signal);
    const { data: row, error } = await this.db.from("video_scene_plans").select("*").eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId).maybeSingle();
    throwIfAborted(signal);
    if (error) throw new VideoProductionError("database_error", "Unable to load the scene plan.", true, 500);
    if (!row) return null;
    const { data: sceneRows, error: sceneError } = await this.db.from("video_scene_items").select("*").eq("user_id", this.userId).eq("plan_id", (row as VideoScenePlanRow).id).eq("is_active", true).order("scene_number");
    throwIfAborted(signal);
    if (sceneError) throw new VideoProductionError("database_error", "Unable to load scene-plan items.", true, 500);
    return mapVideoScenePlan(row as VideoScenePlanRow, (sceneRows ?? []) as VideoSceneItemRow[]);
  }

  async savePlan(brandIdValue: string, projectIdValue: string, scenes?: CreatorVideoScene[], expectedPlanUpdatedAt: string | null = null): Promise<CreatorVideoScenePlan> {
    const brandId = required(brandIdValue, "brandId"); const projectId = required(projectIdValue, "projectId");
    const context = await this.context(brandId, projectId);
    const existing = await this.loadPlan(brandId, projectId);
    const narrationDurationMs = Number(context.audio.duration_ms);
    if (!Number.isSafeInteger(narrationDurationMs) || narrationDurationMs < 1 || narrationDurationMs > CREATOROS_MAX_VIDEO_DURATION_MS) {
      throw new VideoProductionError("duration_unsupported", "CreatorOS supports videos up to 30 minutes.", false, 409);
    }
    const normalized = (scenes ?? buildDeterministicScenes(context.script, narrationDurationMs)).map((scene, index, all) => ({
      ...scene, id: requiredUuid(scene.id, "Scene id"), sceneNumber: index + 1,
      title: required(scene.title, "Scene title"), narrationText: scene.narrationText.trim().slice(0, 1000),
      visualPrompt: required(scene.visualPrompt, "Visual prompt"), startTimeMs: all.slice(0, index).reduce((sum, item) => sum + Math.floor(item.durationMs), 0),
      durationMs: Math.floor(scene.durationMs), status: "planned" as const,
    }));
    if (normalized.reduce((total, scene) => total + scene.durationMs, 0) > CREATOROS_MAX_VIDEO_DURATION_MS) {
      throw new VideoProductionError("duration_unsupported", "CreatorOS supports videos up to 30 minutes.", false, 409);
    }
    const { data, error } = await this.db.rpc("save_video_scene_plan", {
      p_brand_id: brandId, p_project_id: projectId, p_plan_id: existing?.id ?? crypto.randomUUID(),
      p_expected_project_updated_at: context.project.updatedAt,
      p_expected_plan_updated_at: expectedPlanUpdatedAt ?? existing?.updatedAt ?? null, p_scenes: normalized,
    });
    if (error) throw new VideoProductionError("scene_plan_invalid", "The scene plan could not be saved.", false, 409);
    if (!((data ?? []) as VideoScenePlanRow[])[0]) throw new VideoProductionError("scene_plan_conflict", "The project or scene plan changed. Refresh and try again.", true, 409);
    const plan = await this.loadPlan(brandId, projectId);
    if (!plan) throw new VideoProductionError("database_error", "The saved scene plan could not be loaded.", true, 500);
    return plan;
  }

  async history(brandIdValue: string, projectIdValue: string, signal?: AbortSignal): Promise<VideoHistoryResponse> {
    const brandId = required(brandIdValue, "brandId"); const projectId = required(projectIdValue, "projectId");
    const project = await this.loadProject(brandId, projectId, signal);
    throwIfAborted(signal);
    const historyQuery = this.db.from("video_generations").select("*").eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(30);
    const attachedQuery = project.videoGenerationId
      ? this.db.from("video_generations").select("*").eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId).eq("id", project.videoGenerationId).eq("status", "ready").maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const [{ data, error }, { data: attached, error: attachedError }, plan] = await Promise.all([historyQuery, attachedQuery, this.loadPlan(brandId, projectId, signal)]);
    throwIfAborted(signal);
    if (error || attachedError) throw new VideoProductionError("database_error", "Unable to load video history.", true, 500);
    const rows = (data ?? []) as VideoGenerationRow[];
    if (attached && !rows.some((row) => row.id === (attached as VideoGenerationRow).id)) rows.push(attached as VideoGenerationRow);
    return { project, scenePlan: plan, generations: rows.map(mapVideoGeneration) };
  }

  private async storageEntry(path: string, signal?: AbortSignal, bucket = BUCKET): Promise<StorageEntry | null> {
    throwIfAborted(signal);
    const parts = path.split("/"); const filename = parts.pop(); const folder = parts.join("/");
    if (!filename) return null;
    const { data, error } = await this.db.storage.from(bucket).list(folder, { search: filename, limit: 10 });
    throwIfAborted(signal);
    if (error) throw new VideoProductionError("storage_verification_failed", "Private video Storage could not be verified.", true, 500);
    return ((data ?? []) as StorageEntry[]).find((entry) => entry.name === filename) ?? null;
  }

  private async objectMatches(path: string, expectedSize: number, expectedMime: string, signal?: AbortSignal): Promise<boolean> {
    const entry = await this.storageEntry(path, signal);
    if (!entry) return false;
    const size = numericMetadata(entry.metadata, "size");
    const mime = entry.metadata?.mimetype ?? entry.metadata?.contentType;
    return size === expectedSize && mime === expectedMime;
  }

  private async objectContentMatches(path: string, expectedSize: number, expectedMime: string, expectedHash: string, signal?: AbortSignal): Promise<boolean> {
    return Boolean(await this.readMatchingObject(path, expectedSize, expectedMime, expectedHash, signal));
  }

  private async readMatchingObject(path: string, expectedSize: number, expectedMime: string, expectedHash: string, signal?: AbortSignal): Promise<Uint8Array | null> {
    if (!await this.objectMatches(path, expectedSize, expectedMime, signal)) return null;
    const { data, error } = await this.db.storage.from(BUCKET).download(path);
    throwIfAborted(signal);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    throwIfAborted(signal);
    return bytes.byteLength === expectedSize && hash(bytes) === expectedHash ? bytes : null;
  }

  private async validateExactAssetSet(generation: VideoGenerationRow, plan: CreatorVideoScenePlan, expectedProvider: string, expectedModel: string, signal?: AbortSignal): Promise<readonly VideoRenderVisualAssetInput[]> {
    throwIfAborted(signal);
    const { data, error } = await this.db.from("video_visual_assets").select("*")
      .eq("user_id", this.userId).eq("brand_id", generation.brand_id).eq("project_id", generation.project_id)
      .eq("generation_id", generation.id);
    throwIfAborted(signal);
    if (error) throw new VideoProductionError("database_error", "Unable to verify the scene visual set.", true, 500);
    const assets = (data ?? []) as VisualAssetRow[];
    if (assets.length !== plan.scenes.length) {
      throw new VideoProductionError("asset_set_invalid", "The scene visual set is incomplete.", false, 409);
    }
    const scenes = plan.scenes.map((scene) => ({ sceneId: scene.id, sceneNumber: scene.sceneNumber,
      sourceHash: hash(canonicalVideoSceneSource(scene)) }));
    const validated = await Promise.all(assets.map(async (asset) => {
      const scene = plan.scenes.find((entry) => entry.id === asset.scene_id && entry.sceneNumber === asset.scene_number);
      const expectedMime = asset.format === "svg" ? "image/svg+xml" : asset.format === "png" ? "image/png" : null;
      const expectedPath = asset.format
        ? videoVisualAssetStoragePath(this.userId, generation.brand_id, generation.project_id, generation.id, asset.scene_number, asset.format)
        : "";
      const metadataValid = Boolean(scene && expectedMime && asset.mime_type === expectedMime
        && asset.provider === expectedProvider && asset.model === expectedModel
        && asset.file_size_bytes && asset.content_sha256 && /^[0-9a-f]{64}$/.test(asset.content_sha256)
        && Number.isInteger(asset.width) && Number.isInteger(asset.height) && Number(asset.width) > 0 && Number(asset.height) > 0
        && asset.storage_bucket === BUCKET && asset.storage_path === expectedPath);
      const bytes = metadataValid && asset.file_size_bytes && asset.mime_type && asset.content_sha256
        ? await this.readMatchingObject(expectedPath, asset.file_size_bytes, asset.mime_type, asset.content_sha256, signal) : null;
      return {
        candidate: { sceneId: asset.scene_id, sceneNumber: asset.scene_number, planId: asset.scene_plan_id,
          planVersion: asset.source_scene_plan_version, sourceHash: asset.source_scene_sha256,
          ready: asset.status === "ready", metadataValid, objectValid: Boolean(bytes) },
        renderAsset: bytes && asset.width && asset.height ? {
          sceneId: asset.scene_id, sceneNumber: asset.scene_number, bytes, format: asset.format as "svg" | "png",
          mimeType: asset.mime_type as "image/svg+xml" | "image/png", width: asset.width, height: asset.height,
        } : null,
      };
    }));
    if (!isExactAuthoritativeAssetSet(scenes, validated.map((item) => item.candidate), plan.id, plan.version)) {
      throw new VideoProductionError("asset_set_invalid", "The scene visual set failed integrity validation.", false, 409);
    }
    return plan.scenes.map((scene) => {
      const asset = validated.find((item) => item.renderAsset?.sceneId === scene.id
        && item.renderAsset.sceneNumber === scene.sceneNumber)?.renderAsset;
      if (!asset) throw new VideoProductionError("asset_set_invalid", "The scene visual set failed integrity validation.", false, 409);
      return asset;
    });
  }

  private async existingExactAssetSet(generation: VideoGenerationRow, plan: CreatorVideoScenePlan, expectedProvider: string, expectedModel: string, signal?: AbortSignal): Promise<readonly VideoRenderVisualAssetInput[] | null> {
    try {
      return await this.validateExactAssetSet(generation, plan, expectedProvider, expectedModel, signal);
    } catch (error) {
      if (error instanceof VideoProductionError && error.code === "asset_set_invalid") return null;
      throw error;
    }
  }

  private retryMatches(row: VideoGenerationRow, context: Context, plan: CreatorVideoScenePlan, planHash: string): boolean {
    return row.source_script_id === context.script.id
      && row.source_script_updated_at === context.script.updatedAt
      && row.source_content_sha256 === hash(context.script.content)
      && row.source_audio_generation_id === context.audio.id
      && row.source_audio_updated_at === context.audio.updated_at
      && row.source_audio_sha256 === context.audio.source_content_sha256
      && row.source_scene_plan_id === plan.id
      && row.source_scene_plan_version === plan.version
      && row.source_scene_plan_hash === planHash;
  }

  private async markAssetFailed(assetId: string, code: string, message: string, cleanupPending = false): Promise<void> {
    const { data, error } = await this.db.from("video_visual_assets").update({ status: "failed", failure_code: code, failure_message: message, cleanup_pending: cleanupPending })
      .eq("user_id", this.userId).eq("id", assetId).select("id").maybeSingle();
    if (error || !data) safeLog("[CreatorOS video asset failure persistence]", { stage: "asset_failure_persistence", errorName: "DatabaseError", failureCode: code });
  }

  private async persistGenerationFailure(generationId: string, attemptNumber: number, failure: { code: string; message: string }, cleanupPending: boolean): Promise<void> {
    for (let pass = 0; pass < 2; pass += 1) {
      const { data, error } = await this.db.rpc("fail_video_generation", {
        p_generation_id: generationId, p_attempt_number: attemptNumber,
        p_failure_code: failure.code, p_failure_message: failure.message, p_cleanup_pending: cleanupPending,
      });
      if (!error && data === true) return;
    }
    safeLog("[CreatorOS video failure persistence incomplete]", { stage: "failure_persistence", generationId, failureCode: failure.code, errorName: "DatabaseError" });
  }

  async generate(brandIdValue: string, projectIdValue: string, operationIdValue: string, visualProvider: ConfiguredVisualAssetProvider, renderer: ConfiguredVideoRenderer, retryGenerationId?: string, incomingSignal?: AbortSignal): Promise<VideoLifecycleResponse> {
    const brandId = required(brandIdValue, "brandId"); const projectId = required(projectIdValue, "projectId");
    const operationId = requiredUuid(operationIdValue, "operationId");
    const { adapter: rendererAdapter, model: rendererModel, timeoutMs, activeLeaseMs, heartbeatMs } = renderer;
    const { adapter: visualAdapter, model: visualModel } = visualProvider;
    const controller = new AbortController();
    const abortFromRequest = () => controller.abort(new VideoProductionError("cancelled", "Video generation was cancelled.", true, 408));
    incomingSignal?.addEventListener("abort", abortFromRequest, { once: true });
    if (incomingSignal?.aborted) abortFromRequest();
    const timeout = setTimeout(() => controller.abort(new VideoProductionError("timeout", "Video generation timed out.", true, 408)), timeoutMs);
    const signal = controller.signal;
    let generation: VideoGenerationRow | null = null;
    let retrySourceGeneration: VideoGenerationRow | null = null;
    let attemptNumber = 0;
    let recoveryMessage: string | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatInFlight: Promise<void> | null = null;
    let heartbeatStopped = false;
    let heartbeatFailure: VideoProviderError | null = null;
    let lastHeartbeatAt = 0;
    const heartbeat = async (force = false): Promise<void> => {
      if (heartbeatStopped || !generation) return;
      if (heartbeatInFlight) return heartbeatInFlight;
      if (!force && Date.now() - lastHeartbeatAt < heartbeatMs) return;
      const pending = (async () => {
        try {
          const { data, error } = await this.db.rpc("heartbeat_video_generation", {
            p_brand_id: brandId, p_project_id: projectId, p_generation_id: generation?.id, p_lease_ms: activeLeaseMs,
          });
          if (error || data !== true) throw new VideoProviderError("lease_lost", "The video operation lease was lost.", false);
          lastHeartbeatAt = Date.now();
        } catch (error) {
          heartbeatFailure = error instanceof VideoProviderError
            ? error : new VideoProviderError("lease_heartbeat_failed", "The video operation heartbeat failed.", true);
          if (!signal.aborted) controller.abort(heartbeatFailure);
          throw heartbeatFailure;
        }
      })();
      heartbeatInFlight = pending;
      try { await pending; }
      finally { if (heartbeatInFlight === pending) heartbeatInFlight = null; }
    };
    const assertHeartbeat = (): void => { if (heartbeatFailure) throw heartbeatFailure; throwIfAborted(signal); };
    try {
      throwIfAborted(signal);
      const context = await this.context(brandId, projectId, signal);
      const plan = await this.loadPlan(brandId, projectId, signal);
      if (!plan) throw new VideoProductionError("scene_plan_required", "Create and save a scene plan first.");
      const { data: planRow, error: planError } = await this.db.from("video_scene_plans")
        .select("plan_hash, source_script_id, source_audio_generation_id, source_audio_sha256, source_audio_updated_at, source_content_sha256, source_script_updated_at, status")
        .eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId).eq("id", plan.id).single();
      throwIfAborted(signal);
      if (planError || !planRow) throw new VideoProductionError("database_error", "Unable to verify scene-plan provenance.", true, 500);
      if (planRow.status !== "ready" || planRow.source_script_id !== context.script.id || planRow.source_audio_generation_id !== context.audio.id || planRow.source_script_updated_at !== context.script.updatedAt || planRow.source_content_sha256 !== hash(context.script.content) || planRow.source_audio_updated_at !== context.audio.updated_at || planRow.source_audio_sha256 !== context.audio.source_content_sha256) {
        throw new VideoProductionError("stale_scene_plan", "The scene plan is stale. Create or save it again for the current narration.", false, 409);
      }
      const plannedDurationMs = plan.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
      const durationEligibility = evaluateVideoDurationEligibility(
        plannedDurationMs,
         rendererAdapter.descriptor.capabilities.maximumDurationMs,
      );
      if (durationEligibility.violation === "invalid_provider_limit") {
        throw new VideoProductionError("provider_configuration_invalid", "The configured video provider duration limit is invalid.", false, 500);
      }
      if (durationEligibility.violation === "invalid_duration" || durationEligibility.violation === "platform_limit_exceeded") {
        throw new VideoProductionError("duration_unsupported", "CreatorOS supports videos up to 30 minutes.", false, 422);
      }
      if (durationEligibility.violation === "provider_limit_exceeded") {
         throw new VideoProductionError("provider_duration_unsupported", `${rendererAdapter.descriptor.label} supports videos up to ${Math.floor(durationEligibility.maximumDurationMs / 60_000)} minutes.`, false, 422);
      }
      if (plan.scenes.length > rendererAdapter.descriptor.capabilities.maximumScenes
        || plan.scenes.length > visualAdapter.descriptor.capabilities.maximumScenes) {
        throw new VideoProductionError("scene_count_unsupported", "The scene plan exceeds the configured production provider limit.", false, 422);
      }

      let retryId: string | null = null;
      if (retryGenerationId) {
        retryId = requiredUuid(retryGenerationId, "retryGenerationId");
        const { data, error } = await this.db.from("video_generations").select("*").eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId).eq("id", retryId).eq("status", "failed").maybeSingle();
        throwIfAborted(signal);
        if (error) throw new VideoProductionError("database_error", "Unable to load the failed video generation.", true, 500);
        if (!data) throw new VideoProductionError("retry_unavailable", "This failed video can no longer be retried.", false, 409);
        generation = data as VideoGenerationRow;
        retrySourceGeneration = generation;
        if (!this.retryMatches(generation, context, plan, planRow.plan_hash as string)) {
          throw new VideoProductionError("stale_generation", "This failed video uses older project sources. Start a new generation instead.", false, 409);
        }
        if (generation.operation_id === operationId) {
          throw new VideoProductionError("retry_requires_new_operation", "Retry this video with a new operation.", false, 409);
        }
      }

      const requestedGenerationId = crypto.randomUUID();
      if (requestedGenerationId === retryId) {
        throw new VideoProductionError("retry_requires_new_generation", "Retry this video with a new generation.", true, 409);
      }
      const { data: reservedData, error: reserveError } = await this.db.rpc("claim_video_generation_operation", {
        p_brand_id: brandId, p_project_id: projectId, p_operation_id: operationId,
        p_generation_id: requestedGenerationId, p_retry_generation_id: retryId,
        p_source_script_id: context.script.id, p_source_audio_generation_id: context.audio.id,
         p_source_scene_plan_id: plan.id, p_provider: rendererAdapter.descriptor.id, p_model: rendererModel,
        p_source_script_updated_at: context.script.updatedAt, p_source_content_sha256: hash(context.script.content),
        p_source_audio_updated_at: context.audio.updated_at, p_source_audio_sha256: context.audio.source_content_sha256,
        p_source_scene_plan_version: plan.version, p_source_scene_plan_hash: planRow.plan_hash,
        p_scene_count: plan.scenes.length, p_duration_ms: plannedDurationMs,
        p_lease_ms: activeLeaseMs,
      });
      throwIfAborted(signal);
      if (reserveError) throw new VideoProductionError("database_error", "Unable to reserve video generation.", true, 500);
      const reservation = ((reservedData ?? []) as ClaimedGenerationRow[])[0];
      if (!reservation) throw new VideoProductionError("generation_conflict", "The video project changed. Refresh and try again.", true, 409);
      recoveryMessage = reservation.recovery_message;
      const { data: reservedGeneration, error: reservedGenerationError } = await this.db.from("video_generations").select("*")
        .eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId).eq("id", reservation.generation_id).maybeSingle();
      if (reservedGenerationError || !reservedGeneration) throw new VideoProductionError("database_error", "The reserved video generation could not be loaded.", true, 500);
      generation = reservedGeneration as VideoGenerationRow;
      if (generation.status !== "queued") {
        return { ...(await this.history(brandId, projectId, signal)), generation: mapVideoGeneration(generation), recoveryMessage };
      }

      const { data: claimedData, error: claimError } = await this.db.rpc("start_video_generation_attempt", {
        p_brand_id: brandId, p_project_id: projectId, p_generation_id: generation.id,
         p_provider: rendererAdapter.descriptor.id, p_model: rendererModel,
      });
      throwIfAborted(signal);
      if (claimError) throw new VideoProductionError("database_error", "Unable to claim the video generation.", true, 500);
      const claimed = ((claimedData ?? []) as VideoGenerationRow[])[0];
      if (!claimed) {
        const latest = await this.history(brandId, projectId, signal);
        const authoritative = latest.generations.find((item) => item.id === generation?.id) ?? latest.generations.find((item) => ACTIVE_STATUSES.includes(item.status as typeof ACTIVE_STATUSES[number]));
        if (!authoritative) throw new VideoProductionError("generation_conflict", "The video generation changed. Refresh and try again.", true, 409);
        return { ...latest, generation: authoritative, recoveryMessage };
      }
      generation = claimed;
      attemptNumber = generation.attempt_count;
      await heartbeat(true);
      heartbeatTimer = setInterval(() => { void heartbeat(true).catch(() => undefined); }, heartbeatMs);

      const { data: audioBlob, error: audioError } = await this.db.storage.from("project-audio").download(context.audio.storage_path as string);
      throwIfAborted(signal);
      if (audioError || !audioBlob) throw new VideoProductionError("audio_download_failed", "The attached narration could not be read.", true, 500);
      const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
      assertAuthoritativeNarrationSize(audioBytes, context.audio.file_size_bytes);
      await heartbeat();
      assertHeartbeat();
      let renderRequest: VideoRenderRequest = { projectId, projectTitle: context.project.title, model: rendererModel, scenes: plan.scenes,
        audio: { generationId: context.audio.id, durationMs: Number(context.audio.duration_ms), mimeType: "audio/wav", bytes: audioBytes },
        heartbeat: () => heartbeat(), signal };

      const { data: assetStage, error: assetStageError } = await this.db.rpc("advance_video_generation_stage", {
        p_generation_id: generation.id, p_expected_status: "planning", p_next_status: "generating_assets",
      });
      assertHeartbeat();
      if (assetStageError || assetStage !== true) throw new VideoProductionError("lease_lost", "The video asset stage lease was lost.", true, 409);

      let authoritativeVisualAssets = await this.existingExactAssetSet(
        generation, plan, visualAdapter.descriptor.id, visualModel, signal,
      );
      if (!authoritativeVisualAssets) {
        const assets: readonly VideoVisualAssetResult[] = await reuseOrGenerateVisualAssets(async () => {
          const reusableAssets = retrySourceGeneration
            ? await this.existingExactAssetSet(
              retrySourceGeneration, plan, visualAdapter.descriptor.id, visualModel, signal,
            ) : null;
          return reusableAssets?.map((asset) => ({
            ...asset,
            format: asset.format === "png" ? "png" as const : "svg" as const,
            mimeType: asset.mimeType === "image/png" ? "image/png" as const : "image/svg+xml" as const,
            contentSha256: hash(asset.bytes),
          })) ?? null;
        }, () => visualAdapter.generateVisualAssets({
            projectId,
            projectTitle: context.project.title,
            model: visualModel,
            scenes: plan.scenes,
            heartbeat: () => heartbeat(),
            signal,
          }));
        assertHeartbeat();
        if (assets.length !== plan.scenes.length) {
          throw new VideoProviderError("invalid_asset_set", "The visual provider returned an incomplete scene visual set.");
        }
        const providerSceneIds = new Set<string>();
        const providerSceneNumbers = new Set<number>();
        let totalVisualBytes = 0;
        for (const asset of assets) {
          const scene = plan.scenes.find((item) => item.id === asset.sceneId && item.sceneNumber === asset.sceneNumber);
          const typeMatches = (asset.format === "svg" && asset.mimeType === "image/svg+xml")
            || (asset.format === "png" && asset.mimeType === "image/png");
          const contentSha = hash(asset.bytes);
          totalVisualBytes += asset.bytes.byteLength;
          if (!scene || providerSceneIds.has(asset.sceneId) || providerSceneNumbers.has(asset.sceneNumber)
            || !typeMatches || !visualAdapter.descriptor.capabilities.formats.includes(asset.format)
            || asset.bytes.byteLength < 1 || asset.bytes.byteLength > visualAdapter.descriptor.capabilities.maximumBytesPerAsset
            || totalVisualBytes > visualAdapter.descriptor.capabilities.maximumTotalBytes
            || !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width < 1 || asset.height < 1
            || asset.contentSha256 !== contentSha
            || (asset.providerRequestId !== undefined && !/^[A-Za-z0-9._:-]{1,128}$/.test(asset.providerRequestId))) {
            throw new VideoProviderError("invalid_asset_set", "The visual provider returned an invalid scene visual set.");
          }
          providerSceneIds.add(asset.sceneId); providerSceneNumbers.add(asset.sceneNumber);
        }

        const pendingAssets: Array<{ id: string; path: string }> = [];
        let assetSetFinalized = false;
        try {
          for (const asset of assets) {
            await heartbeat();
            assertHeartbeat();
            const scene = plan.scenes.find((item) => item.id === asset.sceneId && item.sceneNumber === asset.sceneNumber) as CreatorVideoScene;
            const path = videoVisualAssetStoragePath(this.userId, brandId, projectId, generation.id, asset.sceneNumber, asset.format);
            const contentSha = hash(asset.bytes);
            const sourceSceneSha = hash(canonicalVideoSceneSource(scene));
            const { data: existingData, error: existingError } = await this.db.from("video_visual_assets").select("*").eq("user_id", this.userId).eq("generation_id", generation.id).eq("scene_number", asset.sceneNumber).maybeSingle();
            throwIfAborted(signal);
            if (existingError) throw new VideoProductionError("asset_persistence_failed", "A scene visual could not be loaded.", true, 500);
            let assetRow = existingData as VisualAssetRow | null;
            if (assetRow?.status === "ready") {
              const readyMime = assetRow.format === "svg" ? "image/svg+xml" : assetRow.format === "png" ? "image/png" : null;
              const readyPath = assetRow.format ? videoVisualAssetStoragePath(this.userId, brandId, projectId, generation.id, assetRow.scene_number, assetRow.format) : "";
              const metadataMatches = assetRow.scene_plan_id === plan.id && assetRow.source_scene_plan_version === plan.version
                && assetRow.scene_id === scene.id && assetRow.source_scene_sha256 === sourceSceneSha
                && assetRow.provider === visualAdapter.descriptor.id && assetRow.model === visualModel
                && assetRow.storage_path === readyPath && assetRow.mime_type === readyMime
                && Boolean(assetRow.file_size_bytes && assetRow.content_sha256 && assetRow.width && assetRow.height);
              if (metadataMatches && assetRow.file_size_bytes && assetRow.mime_type && assetRow.content_sha256
                && await this.objectContentMatches(readyPath, assetRow.file_size_bytes, assetRow.mime_type, assetRow.content_sha256, signal)) continue;
              if (assetRow.storage_path && await this.storageEntry(assetRow.storage_path, signal)) {
                throw new VideoProductionError("asset_integrity_failed", "A finalized scene visual failed integrity validation. Start a new generation.", false, 409);
              }
              await this.markAssetFailed(assetRow.id, "asset_object_missing", "The scene visual object was missing and will be repaired on retry.");
              assetRow = { ...assetRow, status: "failed" };
            }
            if (!assetRow) {
              const { data: reserved, error: reserveError } = await this.db.from("video_visual_assets").insert({ user_id: this.userId, id: crypto.randomUUID(), generation_id: generation.id, scene_plan_id: plan.id, scene_id: asset.sceneId, brand_id: brandId, project_id: projectId, scene_number: asset.sceneNumber, source_scene_title: scene.title, source_narration_text: scene.narrationText, source_visual_prompt: scene.visualPrompt, source_visual_type: scene.visualType, source_duration_ms: scene.durationMs, source_transition: scene.transition, source_scene_sha256: sourceSceneSha, source_scene_plan_version: plan.version, status: "queued", provider: visualAdapter.descriptor.id, model: visualModel, format: asset.format, mime_type: asset.mimeType, storage_bucket: BUCKET, storage_path: path }).select("*").single();
              throwIfAborted(signal);
              if (reserveError || !reserved) throw new VideoProductionError("asset_persistence_failed", "A scene visual could not be reserved.", true, 500);
              assetRow = reserved as VisualAssetRow;
            } else if (assetRow.status === "failed" || assetRow.cleanup_pending) {
              const previousPath = assetRow.storage_path;
              if (previousPath && await this.storageEntry(previousPath, signal)) {
                await removePrivateStorageObject(
                  () => this.db.storage.from(BUCKET).remove([previousPath]),
                  async () => Boolean(await this.storageEntry(previousPath, signal)),
                );
              }
            }
            const { data: generating, error: generatingError } = await this.db.from("video_visual_assets").update({ status: "generating", scene_plan_id: plan.id, scene_id: asset.sceneId, source_scene_title: scene.title, source_narration_text: scene.narrationText, source_visual_prompt: scene.visualPrompt, source_visual_type: scene.visualType, source_duration_ms: scene.durationMs, source_transition: scene.transition, source_scene_sha256: sourceSceneSha, source_scene_plan_version: plan.version, provider: visualAdapter.descriptor.id, model: visualModel, storage_bucket: BUCKET, storage_path: path, format: asset.format, mime_type: asset.mimeType, width: null, height: null, file_size_bytes: null, content_sha256: null, provider_request_id: null, failure_code: null, failure_message: null, cleanup_pending: false }).eq("user_id", this.userId).eq("id", assetRow.id).in("status", ["queued", "failed", "generating", "uploading"]).select("id").maybeSingle();
            throwIfAborted(signal);
            if (generatingError || !generating) throw new VideoProductionError("asset_persistence_failed", "A scene visual could not be claimed.", true, 500);
            const { data: uploading, error: uploadingError } = await this.db.from("video_visual_assets").update({ status: "uploading" }).eq("user_id", this.userId).eq("id", assetRow.id).eq("status", "generating").select("id").maybeSingle();
            throwIfAborted(signal);
            if (uploadingError || !uploading) throw new VideoProductionError("asset_persistence_failed", "A scene visual upload could not be recorded.", true, 500);
            pendingAssets.push({ id: assetRow.id, path });
            const { data: uploaded, error: uploadError } = await this.db.storage.from(BUCKET).upload(path, asset.bytes, { contentType: asset.mimeType, upsert: false });
            throwIfAborted(signal);
            if (uploadError || !uploaded?.path) throw new VideoProductionError("asset_upload_failed", "A scene visual could not be uploaded.", true, 500);
            if (!await this.objectContentMatches(path, asset.bytes.byteLength, asset.mimeType, contentSha, signal)) {
              throw new VideoProductionError("asset_upload_invalid", "A scene visual upload could not be verified.", true, 500);
            }
            const { data: persisted, error: persistError } = await this.db.from("video_visual_assets").update({ format: asset.format, mime_type: asset.mimeType, width: asset.width, height: asset.height, file_size_bytes: asset.bytes.byteLength, content_sha256: contentSha, provider_request_id: asset.providerRequestId ?? null, cleanup_pending: false }).eq("user_id", this.userId).eq("id", assetRow.id).eq("status", "uploading").select("id").maybeSingle();
            throwIfAborted(signal);
            if (persistError || !persisted) throw new VideoProductionError("asset_persistence_failed", "A scene visual metadata record could not be saved.", true, 500);
          }
          const pendingIds = pendingAssets.map((asset) => asset.id);
          const { data: readyAssets, error: readyAssetsError } = await this.db.from("video_visual_assets").update({ status: "ready" })
            .eq("user_id", this.userId).eq("generation_id", generation.id).in("id", pendingIds).eq("status", "uploading").select("id");
          if (readyAssetsError || (readyAssets ?? []).length !== pendingIds.length) {
            throw new VideoProductionError("asset_persistence_failed", "The complete scene visual set could not be finalized.", true, 500);
          }
          assetSetFinalized = true;
          throwIfAborted(signal);
        } catch (error) {
          const failure = safeFailure(error);
          if (!assetSetFinalized) await cleanupPartialVisualAssetUploads(pendingAssets, async (path) => {
              await removePrivateStorageObject(
                () => this.db.storage.from(BUCKET).remove([path]),
                async () => Boolean(await this.storageEntry(path, undefined)),
              );
            }, (assetId, cleanupPending) => this.markAssetFailed(
              assetId, failure.code, failure.message, cleanupPending,
            ));
          throw error;
        }
        await heartbeat();
        assertHeartbeat();
        authoritativeVisualAssets = await this.validateExactAssetSet(
          generation, plan, visualAdapter.descriptor.id, visualModel, signal,
        );
      }
      renderRequest = { ...renderRequest, visualAssets: authoritativeVisualAssets };
      await heartbeat();
      assertHeartbeat();

      const { data: renderStage, error: renderStageError } = await this.db.rpc("advance_video_generation_stage", {
        p_generation_id: generation.id, p_expected_status: "generating_assets", p_next_status: "rendering",
      });
      assertHeartbeat();
      if (renderStageError || renderStage !== true) throw new VideoProductionError("lease_lost", "The video render stage lease was lost.", true, 409);

      const result = await rendererAdapter.render(renderRequest);
      assertHeartbeat();
      if (result.bytes.byteLength > MAX_BYTES || result.mimeType !== "video/mp4" || result.format !== "mp4") throw new VideoProviderError("invalid_render", "The video renderer returned an invalid video.");
      const metadata = validateMp4(result.bytes);
      if (metadata.durationMs !== Math.round(result.durationMs) || metadata.width !== result.width || metadata.height !== result.height
        || metadata.hasAudio !== result.hasAudio || (rendererAdapter.descriptor.capabilities.supportsAudioMux && !metadata.hasAudio)
        || (rendererAdapter.descriptor.capabilities.supportsAudioMux && !metadata.fastStart)
        || !isCompletedVideoDurationValid(plannedDurationMs, metadata.durationMs)) {
        throw new VideoProviderError("invalid_render", "The video renderer returned inconsistent video metadata.");
      }
      await heartbeat();
      assertHeartbeat();

      const renderPath = storagePath(this.userId, brandId, projectId, generation.id);
      const { data: uploadingGeneration, error: uploadingError } = await this.db.rpc("advance_video_generation_stage", {
        p_generation_id: generation.id, p_expected_status: "rendering", p_next_status: "uploading",
      });
      throwIfAborted(signal);
      if (uploadingError || uploadingGeneration !== true) throw new VideoProductionError("lease_lost", "The video upload stage lease was lost.", true, 409);
      const { data: uploadedVideo, error: uploadError } = await this.db.storage.from(BUCKET).upload(renderPath, result.bytes, { contentType: result.mimeType, upsert: false });
      throwIfAborted(signal);
      if (uploadError || !uploadedVideo?.path) throw new VideoProductionError("upload_failed", "The rendered video could not be uploaded.", true, 500);
      if (!await this.objectMatches(renderPath, result.bytes.byteLength, result.mimeType, signal)) throw new VideoProductionError("upload_invalid", "The rendered video upload could not be verified.", true, 500);
      await this.validateExactAssetSet(generation, plan, visualAdapter.descriptor.id, visualModel, signal);
      await heartbeat();
      assertHeartbeat();
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (heartbeatInFlight) await heartbeatInFlight;
      await heartbeat(true);
      assertHeartbeat();
      const { data: readyData, error: readyError } = await this.db.rpc("complete_video_generation", {
        p_generation_id: generation.id, p_attempt_number: attemptNumber, p_scenes_completed: plan.scenes.length,
        p_width: metadata.width, p_height: metadata.height, p_duration_ms: metadata.durationMs,
        p_format: result.format, p_mime_type: result.mimeType, p_file_size_bytes: result.bytes.byteLength,
        p_content_sha256: hash(result.bytes), p_has_audio: result.hasAudio,
      });
      throwIfAborted(signal);
      const readyRow = ((readyData ?? []) as VideoGenerationRow[])[0];
      if (readyError || !readyRow) throw new VideoProductionError("database_error", "The ready video state could not be saved.", true, 500);
      heartbeatStopped = true;
      throwIfAborted(signal);
      const { error: attachError } = await this.db.rpc("attach_ready_video_generation", { p_brand_id: brandId, p_project_id: projectId, p_video_generation_id: generation.id, p_expected_project_updated_at: context.project.updatedAt });
      throwIfAborted(signal);
      if (attachError) safeLog("[CreatorOS video ready but unattached]", { stage: "guarded_attachment", generationId: generation.id, errorName: "DatabaseError" });
      return { ...(await this.history(brandId, projectId, signal)), generation: mapVideoGeneration(readyRow), recoveryMessage };
    } catch (error) {
      const failure = safeFailure(error);
      safeLog("[CreatorOS video generation failure]", { stage: "video_lifecycle", renderer: rendererAdapter.descriptor.id, rendererModel, visualProvider: visualAdapter.descriptor.id, visualModel, errorName: error instanceof Error ? error.name.slice(0, 100) : "UnknownError", failureCode: failure.code, sanitizedMessage: failure.message, retryable: failure.retryable });
      if (generation && attemptNumber > 0) {
        let cleanupPending = false;
        try { const cleanup = await this.db.storage.from(BUCKET).remove([storagePath(this.userId, brandId, projectId, generation.id)]); cleanupPending = Boolean(cleanup.error); }
        catch { cleanupPending = true; }
        await this.persistGenerationFailure(generation.id, attemptNumber, failure, cleanupPending);
        const latest = await this.history(brandId, projectId);
        return { ...latest, generation: latest.generations.find((item) => item.id === generation?.id) ?? mapVideoGeneration(generation), recoveryMessage };
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      heartbeatStopped = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      incomingSignal?.removeEventListener("abort", abortFromRequest);
    }
  }

  async deleteProject(brandIdValue: string, projectIdValue: string, expectedUpdatedAtValue: string): Promise<boolean> {
    const brandId = required(brandIdValue, "brandId");
    const projectId = required(projectIdValue, "projectId");
    const expectedUpdatedAt = required(expectedUpdatedAtValue, "expectedUpdatedAt");
    const { data: markerData, error: markerError } = await this.db.rpc("begin_video_project_deletion", {
      p_brand_id: brandId, p_project_id: projectId, p_expected_updated_at: expectedUpdatedAt,
    });
    if (markerError) throw new VideoProductionError("deletion_conflict", "The project changed. Refresh before deleting it.", true, 409);
    if (!((markerData ?? []) as VideoProjectRow[])[0]) return false;

    const [generationResult, assetResult, audioResult] = await Promise.all([
      this.db.from("video_generations").select("storage_bucket, storage_path").eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId),
      this.db.from("video_visual_assets").select("storage_bucket, storage_path").eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId),
      this.db.from("audio_generations").select("storage_bucket, storage_path").eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId),
    ]);
    if (generationResult.error || assetResult.error || audioResult.error) {
      throw new VideoProductionError("cleanup_failed", "Project media cleanup could not be prepared. Retry deletion.", true, 500);
    }
    const storedRows = [
      ...((generationResult.data ?? []) as StoredPathRow[]),
      ...((assetResult.data ?? []) as StoredPathRow[]),
      ...((audioResult.data ?? []) as StoredPathRow[]),
    ];
    const expectedPrefix = `${this.userId}/${brandId}/${projectId}/`;
    const objects = new Map<string, { bucket: string; path: string }>();
    for (const row of storedRows) {
      if (!row.storage_path) continue;
      if ((row.storage_bucket !== BUCKET && row.storage_bucket !== "project-audio") || !row.storage_path.startsWith(expectedPrefix)) {
        throw new VideoProductionError("cleanup_integrity_failed", "Project media cleanup failed an integrity check.", false, 409);
      }
      objects.set(`${row.storage_bucket}:${row.storage_path}`, { bucket: row.storage_bucket, path: row.storage_path });
    }
    for (const object of objects.values()) {
      await removePrivateStorageObject(
        () => this.db.storage.from(object.bucket).remove([object.path]),
        async () => Boolean(await this.storageEntry(object.path, undefined, object.bucket)),
      );
    }
    const { data: deleted, error: deleteError } = await this.db.rpc("finish_video_project_deletion", {
      p_brand_id: brandId, p_project_id: projectId,
    });
    if (deleteError) throw new VideoProductionError("deletion_failed", "Project records could not be deleted after media cleanup. Retry deletion.", true, 500);
    return deleted === true;
  }

  async attach(brandId: string, projectId: string, generationId: string, expectedUpdatedAt: string): Promise<CreatorVideoProject | null> {
    const { data, error } = await this.db.rpc("attach_ready_video_generation", { p_brand_id: required(brandId, "brandId"), p_project_id: required(projectId, "projectId"), p_video_generation_id: requiredUuid(generationId, "generationId"), p_expected_project_updated_at: required(expectedUpdatedAt, "expectedUpdatedAt") });
    if (error) throw new VideoProductionError("attachment_failed", "The ready video could not be attached.", true, 409);
    const row = ((data ?? []) as VideoProjectRow[])[0]; return row ? mapVideoProjectRowToProject(row) : null;
  }

  async access(brandIdValue: string, projectIdValue: string, generationIdValue: string, purpose: "playback" | "download"): Promise<SecureVideoAccess> {
    const brandId = required(brandIdValue, "brandId"); const projectId = required(projectIdValue, "projectId"); const generationId = requiredUuid(generationIdValue, "generationId");
    await this.loadProject(brandId, projectId);
    const { data, error } = await this.db.from("video_generations").select("*").eq("user_id", this.userId).eq("brand_id", brandId).eq("project_id", projectId).eq("id", generationId).eq("status", "ready").maybeSingle();
    if (error) throw new VideoProductionError("database_error", "Unable to verify the ready video.", true, 500);
    if (!data) throw new VideoProductionError("not_found", "Ready video not found.", false, 404);
    const row = data as VideoGenerationRow;
    const path = storagePath(this.userId, brandId, projectId, generationId);
    if (row.storage_bucket !== BUCKET || row.storage_path !== path || !row.file_size_bytes || !row.content_sha256 || row.mime_type !== "video/mp4") throw new VideoProductionError("integrity_failed", "The ready video failed integrity validation.", false, 409);
    const storageEntry = await this.storageEntry(path);
    if (!storageEntry) {
      const { data: failedForLoss, error: lossError } = await this.db.rpc("fail_ready_video_storage_loss", { p_brand_id: brandId, p_project_id: projectId, p_generation_id: generationId });
      if (lossError) throw new VideoProductionError("access_failed", "Secure video access could not be verified.", true, 500);
      if (failedForLoss === true) throw new VideoProductionError("integrity_failed", "The ready video object is missing. Its project attachment was cleared safely.", false, 409);
      throw new VideoProductionError("access_failed", "Secure video access could not be verified. Refresh and try again.", true, 409);
    }
    const { data: blob, error: downloadError } = await this.db.storage.from(BUCKET).download(path);
    if (downloadError || !blob) {
      const { data: failedForLoss } = await this.db.rpc("fail_ready_video_storage_loss", { p_brand_id: brandId, p_project_id: projectId, p_generation_id: generationId });
      if (failedForLoss === true) throw new VideoProductionError("integrity_failed", "The ready video object is missing. Its project attachment was cleared safely.", false, 409);
      throw new VideoProductionError("access_failed", "Secure video access could not be created.", true, 500);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const metadata = validateMp4(bytes);
    if (bytes.byteLength !== row.file_size_bytes || hash(bytes) !== row.content_sha256 || metadata.durationMs !== row.duration_ms
      || metadata.width !== row.width || metadata.height !== row.height || metadata.hasAudio !== row.has_audio
      || (row.provider === "ffmpeg" && !metadata.fastStart)) {
      throw new VideoProductionError("integrity_failed", "The ready video failed integrity validation.", false, 409);
    }
    const filename = `creatoros-video-${generationId.slice(0, 8)}.mp4`;
    const { data: signed, error: signedError } = await this.db.storage.from(BUCKET).createSignedUrl(path, 300, purpose === "download" ? { download: filename } : undefined);
    if (signedError || !signed?.signedUrl) throw new VideoProductionError("access_failed", "Secure video access could not be created.", true, 500);
    return { videoGenerationId: generationId, accessUrl: signed.signedUrl, expiresAt: new Date(Date.now() + 300_000).toISOString(), filename, mimeType: "video/mp4", purpose };
  }
}

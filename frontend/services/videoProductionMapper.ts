import type {
  CreatorVideoGeneration,
  CreatorVideoGenerationAttempt,
  CreatorVideoScene,
  CreatorVideoScenePlan,
  VideoGenerationStatus,
  VideoSceneTransition,
  VideoSceneVisualType,
} from "@/types/videoProduction";

export interface VideoScenePlanRow {
  user_id: string; id: string; brand_id: string; project_id: string;
  status: "ready" | "stale"; version: number; narration_duration_ms: number;
  created_at: string; updated_at: string;
}
export interface VideoSceneItemRow {
  user_id: string; id: string; plan_id: string; brand_id: string; project_id: string;
  scene_number: number; title: string; narration_text: string; visual_prompt: string;
  visual_type: VideoSceneVisualType; start_time_ms: number; duration_ms: number;
  transition: VideoSceneTransition; status: CreatorVideoScene["status"]; is_active: boolean;
}
export interface VideoGenerationRow {
  user_id: string; id: string; brand_id: string; project_id: string; operation_id: string;
  source_script_id: string | null; source_audio_generation_id: string | null; source_scene_plan_id: string;
  source_script_updated_at: string; source_content_sha256: string; source_audio_updated_at: string;
  source_audio_sha256: string; source_scene_plan_version: number; source_scene_plan_hash: string;
  status: VideoGenerationStatus; provider: string; model: string; scene_count: number;
  duration_ms: number; width: number | null; height: number | null; format: "mp4" | null;
  mime_type: "video/mp4" | null; file_size_bytes: number | null; content_sha256: string | null;
  storage_bucket: string | null; storage_path: string | null; has_audio: boolean; cleanup_pending: boolean;
  failure_code: string | null; failure_message: string | null; attempt_count: number;
  heartbeat_at: string | null; lease_expires_at: string | null;
  created_at: string; completed_at: string | null;
}
export interface VideoGenerationAttemptRow {
  user_id: string; generation_id: string; attempt_number: number;
  status: CreatorVideoGenerationAttempt["status"]; scenes_completed: number;
  failure_code: string | null; failure_message: string | null;
  started_at: string; completed_at: string | null;
}

export function mapVideoScene(row: VideoSceneItemRow): CreatorVideoScene {
  return { id: row.id, sceneNumber: row.scene_number, title: row.title,
    narrationText: row.narration_text, visualPrompt: row.visual_prompt,
    visualType: row.visual_type, startTimeMs: Number(row.start_time_ms),
    durationMs: Number(row.duration_ms), transition: row.transition, status: row.status };
}
export function mapVideoScenePlan(row: VideoScenePlanRow, scenes: VideoSceneItemRow[]): CreatorVideoScenePlan {
  return { id: row.id, brandId: row.brand_id, projectId: row.project_id,
    status: row.status, version: row.version, narrationDurationMs: Number(row.narration_duration_ms),
    scenes: scenes.sort((a, b) => a.scene_number - b.scene_number).map(mapVideoScene),
    createdAt: row.created_at, updatedAt: row.updated_at };
}
export function mapVideoGeneration(row: VideoGenerationRow): CreatorVideoGeneration {
  return { id: row.id, projectId: row.project_id, operationId: row.operation_id,
    status: row.status, developmentMock: row.provider === "mock", sceneCount: row.scene_count,
    durationMs: Number(row.duration_ms), width: row.width, height: row.height,
    format: row.format, mimeType: row.mime_type, fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    hasAudio: row.has_audio, failureCode: row.failure_code, failureMessage: row.failure_message,
    attemptCount: row.attempt_count, createdAt: row.created_at, completedAt: row.completed_at };
}
export function mapVideoAttempt(row: VideoGenerationAttemptRow): CreatorVideoGenerationAttempt {
  return { generationId: row.generation_id, attemptNumber: row.attempt_number,
    status: row.status, scenesCompleted: row.scenes_completed, failureCode: row.failure_code,
    failureMessage: row.failure_message, startedAt: row.started_at, completedAt: row.completed_at };
}

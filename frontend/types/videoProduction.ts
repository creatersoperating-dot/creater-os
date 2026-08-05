import type { CreatorVideoProject } from "@/types/videoProject";

export const VIDEO_SCENE_VISUAL_TYPES = ["title", "image", "text", "quote", "outro"] as const;
export const VIDEO_SCENE_TRANSITIONS = ["cut", "fade", "dissolve"] as const;
export const VIDEO_GENERATION_STATUSES = [
  "queued", "planning", "generating_assets", "rendering", "uploading", "ready", "failed", "cancelled",
] as const;

export type VideoSceneVisualType = (typeof VIDEO_SCENE_VISUAL_TYPES)[number];
export type VideoSceneTransition = (typeof VIDEO_SCENE_TRANSITIONS)[number];
export type VideoGenerationStatus = (typeof VIDEO_GENERATION_STATUSES)[number];

export interface CreatorVideoScene {
  id: string;
  sceneNumber: number;
  title: string;
  narrationText: string;
  visualPrompt: string;
  visualType: VideoSceneVisualType;
  startTimeMs: number;
  durationMs: number;
  transition: VideoSceneTransition;
  status: "planned" | "asset_ready" | "asset_failed";
}

export interface CreatorVideoScenePlan {
  id: string;
  brandId: string;
  projectId: string;
  status: "ready" | "stale";
  version: number;
  narrationDurationMs: number;
  scenes: CreatorVideoScene[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatorVideoGeneration {
  id: string;
  projectId: string;
  operationId: string;
  status: VideoGenerationStatus;
  developmentMock: boolean;
  sceneCount: number;
  durationMs: number;
  width: number | null;
  height: number | null;
  format: "mp4" | null;
  mimeType: "video/mp4" | null;
  fileSizeBytes: number | null;
  hasAudio: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  attemptCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface CreatorVideoGenerationAttempt {
  generationId: string;
  attemptNumber: number;
  status: "rendering" | "completed" | "failed" | "cancelled";
  scenesCompleted: number;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface VideoHistoryResponse {
  project: CreatorVideoProject;
  scenePlan: CreatorVideoScenePlan | null;
  generations: CreatorVideoGeneration[];
}

export interface VideoLifecycleResponse extends VideoHistoryResponse {
  generation: CreatorVideoGeneration;
  recoveryMessage: string | null;
}

export interface SecureVideoAccess {
  videoGenerationId: string;
  accessUrl: string;
  expiresAt: string;
  filename: string;
  mimeType: "video/mp4";
  purpose: "playback" | "download";
}

export class VideoProductionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly status = 400,
  ) {
    super(message);
    this.name = "VideoProductionError";
  }
}

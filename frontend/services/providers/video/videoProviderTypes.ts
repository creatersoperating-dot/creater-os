import "server-only";

export interface VideoProviderDescriptor {
  id: "mock" | "ffmpeg";
  label: string;
  developmentOnly: boolean;
  capabilities: VideoProviderCapabilities;
}
export interface VideoProviderCapabilities {
  containers: readonly ["mp4"];
  supportsAudioMux: boolean;
  maximumDurationMs: number;
  maximumScenes: number;
}
export interface VideoProviderDiagnostic {
  stage: "validation" | "asset_generation" | "rendering";
  errorName: string;
  providerErrorCode: string;
  sanitizedMessage: string;
  retryable: boolean;
}
export interface VideoRenderSceneInput {
  id: string; sceneNumber: number; title: string; narrationText: string;
  visualPrompt: string; visualType: string; durationMs: number; transition: string;
}
export interface VideoRenderAudioInput {
  generationId: string; durationMs: number; mimeType: string; bytes: Uint8Array;
}
export type VideoVisualAssetFormat = "svg" | "png" | "jpeg";
export type VideoVisualAssetMimeType = "image/svg+xml" | "image/png" | "image/jpeg";
export interface VideoRenderVisualAssetInput {
  sceneId: string; sceneNumber: number; bytes: Uint8Array; format: VideoVisualAssetFormat;
  mimeType: VideoVisualAssetMimeType; width: number; height: number;
}
export interface VideoRenderRequest {
  projectId: string; projectTitle: string; model: string;
  scenes: readonly VideoRenderSceneInput[]; audio: VideoRenderAudioInput; signal?: AbortSignal;
  visualAssets?: readonly VideoRenderVisualAssetInput[];
  heartbeat?: () => Promise<void>;
}
export interface VideoVisualAssetResult {
  sceneId: string; sceneNumber: number; bytes: Uint8Array; format: "svg";
  mimeType: "image/svg+xml"; width: number; height: number;
}
export interface VideoRenderResult {
  bytes: Uint8Array; format: "mp4"; mimeType: "video/mp4";
  width: number; height: number; durationMs: number; hasAudio: boolean;
  providerRequestId: string;
}
export interface VideoProviderAdapter {
  descriptor: VideoProviderDescriptor;
  generateVisualAssets(request: VideoRenderRequest): Promise<readonly VideoVisualAssetResult[]>;
  render(request: VideoRenderRequest): Promise<VideoRenderResult>;
}
export interface ConfiguredVideoRenderer {
  adapter: VideoProviderAdapter;
  model: string;
  timeoutMs: number;
  activeLeaseMs: number;
  heartbeatMs: number;
}
export class VideoProviderError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message); this.name = "VideoProviderError";
  }
}

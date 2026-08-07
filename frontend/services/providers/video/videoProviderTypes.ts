import "server-only";

export interface VideoRendererDescriptor {
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
export interface VisualAssetProviderDescriptor {
  id: "mock" | "gemini";
  label: string;
  developmentOnly: boolean;
  capabilities: VisualAssetProviderCapabilities;
}
export interface VisualAssetProviderCapabilities {
  formats: readonly ("svg" | "png")[];
  maximumScenes: number;
  maximumBytesPerAsset: number;
  maximumTotalBytes: number;
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
export interface VisualAssetGenerationRequest {
  projectId: string; projectTitle: string; model: string;
  scenes: readonly VideoRenderSceneInput[]; signal?: AbortSignal;
  heartbeat?: () => Promise<void>;
}
export interface VideoVisualAssetResult {
  sceneId: string; sceneNumber: number; bytes: Uint8Array; format: "svg" | "png";
  mimeType: "image/svg+xml" | "image/png"; width: number; height: number;
  contentSha256: string; providerRequestId?: string;
}
export interface VideoRenderResult {
  bytes: Uint8Array; format: "mp4"; mimeType: "video/mp4";
  width: number; height: number; durationMs: number; hasAudio: boolean;
  providerRequestId: string;
}
export interface VisualAssetProviderAdapter {
  descriptor: VisualAssetProviderDescriptor;
  generateVisualAssets(request: VisualAssetGenerationRequest): Promise<readonly VideoVisualAssetResult[]>;
}
export interface VideoRendererAdapter {
  descriptor: VideoRendererDescriptor;
  render(request: VideoRenderRequest): Promise<VideoRenderResult>;
}
export interface ConfiguredVisualAssetProvider {
  adapter: VisualAssetProviderAdapter;
  model: string;
  timeoutMs: number;
  maxConcurrency: number;
}
export interface ConfiguredVideoRenderer {
  adapter: VideoRendererAdapter;
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

"use client";

import { VIDEO_PROJECT_STATUSES, type CreatorVideoProject } from "@/types/videoProject";
import {
  VIDEO_GENERATION_STATUSES,
  VIDEO_SCENE_TRANSITIONS,
  VIDEO_SCENE_VISUAL_TYPES,
  type CreatorVideoGeneration,
  type CreatorVideoScene,
  type CreatorVideoScenePlan,
  type SecureVideoAccess,
  type VideoHistoryResponse,
  type VideoLifecycleResponse,
} from "@/types/videoProduction";

type RecordValue = Record<string, unknown>;
interface SafeApiError { error?: { code?: string; message?: string; retryable?: boolean } }
type Validator<T> = (value: unknown) => T;

function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Malformed ${name} response.`);
  return value as RecordValue;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Malformed ${name} response.`);
  return value;
}
function nullableString(value: unknown, name: string): string | null { return value === null ? null : string(value, name); }
function number(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Malformed ${name} response.`);
  return value;
}
function nullableNumber(value: unknown, name: string): number | null { return value === null ? null : number(value, name); }
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Malformed ${name} response.`);
  return value;
}
function oneOf<T extends readonly string[]>(value: unknown, values: T, name: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`Malformed ${name} response.`);
  return value as T[number];
}
function iso(value: unknown, name: string): string {
  const result = string(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`Malformed ${name} response.`);
  return result;
}

function project(value: unknown): CreatorVideoProject {
  const item = record(value, "project");
  return {
    id: string(item.id, "project id"), brandId: string(item.brandId, "project brand"),
    scriptId: nullableString(item.scriptId, "project script"), audioGenerationId: nullableString(item.audioGenerationId, "project audio"),
    videoGenerationId: nullableString(item.videoGenerationId, "project video"), title: string(item.title, "project title"),
    topic: typeof item.topic === "string" ? item.topic : (() => { throw new Error("Malformed project topic response."); })(),
    status: oneOf(item.status, VIDEO_PROJECT_STATUSES, "project status"), createdAt: iso(item.createdAt, "project createdAt"), updatedAt: iso(item.updatedAt, "project updatedAt"),
  };
}
function scene(value: unknown): CreatorVideoScene {
  const item = record(value, "scene");
  const status = oneOf(item.status, ["planned", "asset_ready", "asset_failed"] as const, "scene status");
  return { id: string(item.id, "scene id"), sceneNumber: number(item.sceneNumber, "scene number"), title: string(item.title, "scene title"),
    narrationText: typeof item.narrationText === "string" ? item.narrationText : (() => { throw new Error("Malformed scene narration response."); })(),
    visualPrompt: string(item.visualPrompt, "scene visual prompt"), visualType: oneOf(item.visualType, VIDEO_SCENE_VISUAL_TYPES, "scene visual type"),
    startTimeMs: number(item.startTimeMs, "scene start"), durationMs: number(item.durationMs, "scene duration"),
    transition: oneOf(item.transition, VIDEO_SCENE_TRANSITIONS, "scene transition"), status };
}
function scenePlan(value: unknown): CreatorVideoScenePlan {
  const item = record(value, "scene plan");
  if (!Array.isArray(item.scenes)) throw new Error("Malformed scene-plan scenes response.");
  const scenes = item.scenes.map(scene);
  if (scenes.length < 1 || scenes.some((entry, index) => entry.sceneNumber !== index + 1 || entry.durationMs <= 0)) throw new Error("Malformed scene-plan ordering response.");
  return { id: string(item.id, "scene-plan id"), brandId: string(item.brandId, "scene-plan brand"), projectId: string(item.projectId, "scene-plan project"),
    status: oneOf(item.status, ["ready", "stale"] as const, "scene-plan status"), version: number(item.version, "scene-plan version"),
    narrationDurationMs: number(item.narrationDurationMs, "scene-plan duration"), scenes,
    createdAt: iso(item.createdAt, "scene-plan createdAt"), updatedAt: iso(item.updatedAt, "scene-plan updatedAt") };
}
function generation(value: unknown): CreatorVideoGeneration {
  const item = record(value, "video generation");
  return { id: string(item.id, "generation id"), projectId: string(item.projectId, "generation project"), operationId: string(item.operationId, "generation operation"),
    status: oneOf(item.status, VIDEO_GENERATION_STATUSES, "generation status"), developmentMock: boolean(item.developmentMock, "generation development marker"),
    sceneCount: number(item.sceneCount, "generation scene count"), durationMs: number(item.durationMs, "generation duration"),
    width: nullableNumber(item.width, "generation width"), height: nullableNumber(item.height, "generation height"),
    format: item.format === null ? null : oneOf(item.format, ["mp4"] as const, "generation format"),
    mimeType: item.mimeType === null ? null : oneOf(item.mimeType, ["video/mp4"] as const, "generation MIME"),
    fileSizeBytes: nullableNumber(item.fileSizeBytes, "generation size"), hasAudio: boolean(item.hasAudio, "generation audio marker"),
    failureCode: nullableString(item.failureCode, "generation failure code"), failureMessage: nullableString(item.failureMessage, "generation failure message"),
    attemptCount: number(item.attemptCount, "generation attempt count"), createdAt: iso(item.createdAt, "generation createdAt"),
    completedAt: item.completedAt === null ? null : iso(item.completedAt, "generation completedAt") };
}
function history(value: unknown): VideoHistoryResponse {
  const item = record(value, "video history");
  if (!Array.isArray(item.generations)) throw new Error("Malformed video history response.");
  return { project: project(item.project), scenePlan: item.scenePlan === null ? null : scenePlan(item.scenePlan), generations: item.generations.map(generation) };
}
function lifecycle(value: unknown): VideoLifecycleResponse {
  const item = record(value, "video lifecycle");
  return { ...history(item), generation: generation(item.generation),
    recoveryMessage: item.recoveryMessage === null ? null : string(item.recoveryMessage, "video recovery message") };
}
function access(value: unknown): SecureVideoAccess {
  const item = record(value, "video access");
  const accessUrl = string(item.accessUrl, "video access URL");
  let parsed: URL;
  try { parsed = new URL(accessUrl); } catch { throw new Error("Malformed video access URL response."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Malformed video access URL response.");
  const filename = string(item.filename, "video filename");
  if (!/^[a-zA-Z0-9._-]+\.mp4$/.test(filename)) throw new Error("Malformed video filename response.");
  return { videoGenerationId: string(item.videoGenerationId, "video access generation"), accessUrl,
    expiresAt: iso(item.expiresAt, "video access expiry"), filename, mimeType: oneOf(item.mimeType, ["video/mp4"] as const, "video access MIME"),
    purpose: oneOf(item.purpose, ["playback", "download"] as const, "video access purpose") };
}
function safeApiError(value: unknown): SafeApiError {
  const body = record(value, "error");
  if (body.error === undefined) return {};
  const error = record(body.error, "error");
  return { error: { code: typeof error.code === "string" ? error.code : undefined, message: typeof error.message === "string" ? error.message : undefined, retryable: typeof error.retryable === "boolean" ? error.retryable : undefined } };
}
async function responseJson<T>(response: Response, validator: Validator<T>): Promise<T> {
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("Video production returned an unreadable response."); }
  if (!response.ok) {
    const safe = safeApiError(body);
    throw new Error(safe.error?.message?.trim() || "Video production request failed.");
  }
  return validator(body);
}
function base(brandId: string, projectId: string): string { return `/api/brands/${encodeURIComponent(brandId)}/projects/${encodeURIComponent(projectId)}`; }

export async function getVideoProductionHistory(brandId: string, projectId: string, signal?: AbortSignal): Promise<VideoHistoryResponse> {
  return responseJson(await fetch(`${base(brandId, projectId)}/video-history`, { signal, cache: "no-store" }), history);
}
export async function createVideoScenePlan(brandId: string, projectId: string, signal?: AbortSignal): Promise<CreatorVideoScenePlan> {
  return responseJson(await fetch(`${base(brandId, projectId)}/scene-plan`, { method: "POST", signal }), scenePlan);
}
export async function saveVideoScenePlan(brandId: string, projectId: string, plan: CreatorVideoScenePlan, signal?: AbortSignal): Promise<CreatorVideoScenePlan> {
  return responseJson(await fetch(`${base(brandId, projectId)}/scene-plan`, { method: "PUT", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenes: plan.scenes, expectedUpdatedAt: plan.updatedAt }) }), scenePlan);
}
export async function generateProjectVideo(brandId: string, projectId: string, operationId: string, retryGenerationId?: string, signal?: AbortSignal): Promise<VideoLifecycleResponse> {
  return responseJson(await fetch(`${base(brandId, projectId)}/video-generations`, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId, retryGenerationId }) }), lifecycle);
}
export async function attachReadyProjectVideo(brandId: string, projectId: string, videoId: string, expectedProjectUpdatedAt: string, signal?: AbortSignal): Promise<CreatorVideoProject> {
  return responseJson(await fetch(`${base(brandId, projectId)}/video-generations/${encodeURIComponent(videoId)}/attach`, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedProjectUpdatedAt }) }), project);
}
export async function getSecureVideoAccess(brandId: string, projectId: string, videoId: string, purpose: "playback" | "download", signal?: AbortSignal): Promise<SecureVideoAccess> {
  return responseJson(await fetch(`${base(brandId, projectId)}/video-generations/${encodeURIComponent(videoId)}/access`, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose }) }), access);
}
export function normalizeSceneOrder(scenes: readonly CreatorVideoScene[]): CreatorVideoScene[] {
  let start = 0;
  return scenes.map((entry, index) => { const normalized = { ...entry, sceneNumber: index + 1, startTimeMs: start }; start += normalized.durationMs; return normalized; });
}

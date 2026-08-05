import { CREATOROS_MAX_VIDEO_DURATION_MS, CREATOROS_MAX_VIDEO_SCENE_DURATION_MS } from "./videoDurationContract";

export interface ValidatedVideoSceneRequest {
  id: string;
  sceneNumber: number;
  title: string;
  narrationText: string;
  visualPrompt: string;
  visualType: "title" | "image" | "text" | "quote" | "outro";
  startTimeMs: number;
  durationMs: number;
  transition: "cut" | "fade" | "dissolve";
  status: "planned";
}

export class VideoSceneRequestValidationError extends Error {
  constructor(message: string) { super(message); this.name = "VideoSceneRequestValidationError"; }
}

function sceneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VideoSceneRequestValidationError("Every scene must be an object.");
  return value as Record<string, unknown>;
}
function sceneString(value: unknown, field: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && value.trim() === "")) throw new VideoSceneRequestValidationError(`Scene ${field} is invalid.`);
  return value;
}
function sceneInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new VideoSceneRequestValidationError(`Scene ${field} is invalid.`);
  return value;
}

export function parseVideoSceneRequest(value: unknown): ValidatedVideoSceneRequest[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) throw new VideoSceneRequestValidationError("Scenes must contain between 1 and 24 items.");
  const allowedKeys = ["id", "sceneNumber", "title", "narrationText", "visualPrompt", "visualType", "startTimeMs", "durationMs", "transition", "status"] as const;
  const scenes = value.map((entry) => {
    const scene = sceneRecord(entry);
    if (Object.keys(scene).some((key) => !allowedKeys.includes(key as typeof allowedKeys[number]))) throw new VideoSceneRequestValidationError("A scene contains unsupported fields.");
    const id = sceneString(scene.id, "id", 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new VideoSceneRequestValidationError("Scene id is invalid.");
    const visualType = sceneString(scene.visualType, "visual type", 20);
    if (!(["title", "image", "text", "quote", "outro"] as const).includes(visualType as ValidatedVideoSceneRequest["visualType"])) throw new VideoSceneRequestValidationError("Scene visual type is invalid.");
    const transition = sceneString(scene.transition, "transition", 20);
    if (!(["cut", "fade", "dissolve"] as const).includes(transition as ValidatedVideoSceneRequest["transition"])) throw new VideoSceneRequestValidationError("Scene transition is invalid.");
    if (scene.status !== "planned") throw new VideoSceneRequestValidationError("Scene status is invalid.");
    return { id, sceneNumber: sceneInteger(scene.sceneNumber, "number", 1, 24), title: sceneString(scene.title, "title", 200),
      narrationText: sceneString(scene.narrationText, "narration", 1000, true), visualPrompt: sceneString(scene.visualPrompt, "visual prompt", 2000),
      visualType: visualType as ValidatedVideoSceneRequest["visualType"], startTimeMs: sceneInteger(scene.startTimeMs, "start time", 0, CREATOROS_MAX_VIDEO_DURATION_MS),
      durationMs: sceneInteger(scene.durationMs, "duration", 250, CREATOROS_MAX_VIDEO_SCENE_DURATION_MS), transition: transition as ValidatedVideoSceneRequest["transition"], status: "planned" as const };
  });
  if (scenes.reduce((total, scene) => total + scene.durationMs, 0) > CREATOROS_MAX_VIDEO_DURATION_MS) {
    throw new VideoSceneRequestValidationError("Total scene duration exceeds the 30-minute CreatorOS limit.");
  }
  return scenes;
}

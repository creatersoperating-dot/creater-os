import "server-only";

import type { CreatorScript } from "@/types/script";
import type { CreatorVideoScene } from "@/types/videoProduction";
import { CREATOROS_MAX_VIDEO_SCENE_DURATION_MS } from "@/services/video/videoDurationContract";

export const MOCK_VIDEO_FRAME_RATE = 4;
export const MOCK_VIDEO_FRAME_MS = 1000 / MOCK_VIDEO_FRAME_RATE;

function sourceParts(content: string): string[] {
  const paragraphs = content.split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  const words = content.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [content.trim()].filter(Boolean);
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" ")].filter(Boolean);
}

export function allocateSceneFrameCounts(durationMs: number, requestedSceneCount: number): number[] {
  const totalFrames = Math.max(1, Math.round(durationMs / MOCK_VIDEO_FRAME_MS));
  const sceneCount = Math.max(1, Math.min(requestedSceneCount, 24, totalFrames));
  const base = Math.floor(totalFrames / sceneCount);
  const remainder = totalFrames % sceneCount;
  return Array.from({ length: sceneCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function allocateFrameCountsForDurations(durationsMs: readonly number[]): number[] {
  if (durationsMs.length === 0) return [];
  const totalDurationMs = durationsMs.reduce((sum, duration) => sum + Math.max(0, duration), 0);
  const totalFrames = Math.max(durationsMs.length, Math.round(totalDurationMs / MOCK_VIDEO_FRAME_MS));
  const remainingFrames = totalFrames - durationsMs.length;
  if (remainingFrames === 0 || totalDurationMs <= 0) return durationsMs.map(() => 1);
  const shares = durationsMs.map((duration, index) => {
    const exact = Math.max(0, duration) / totalDurationMs * remainingFrames;
    return { index, frames: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let assigned = shares.reduce((sum, share) => sum + share.frames, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (assigned >= remainingFrames) break;
    share.frames += 1; assigned += 1;
  }
  return shares.sort((a, b) => a.index - b.index).map((share) => share.frames + 1);
}

export function buildDeterministicScenes(script: CreatorScript, narrationDurationMs: number): CreatorVideoScene[] {
  const parts = sourceParts(script.content);
  const requestedSceneCount = Math.min(24, Math.max(
    1,
    Math.ceil(parts.length / 2),
    Math.ceil(narrationDurationMs / CREATOROS_MAX_VIDEO_SCENE_DURATION_MS),
  ));
  const frameCounts = allocateSceneFrameCounts(narrationDurationMs, requestedSceneCount);
  const groups = Array.from({ length: frameCounts.length }, (_, index) => {
    const start = Math.floor(index * parts.length / frameCounts.length);
    const end = Math.max(start + 1, Math.floor((index + 1) * parts.length / frameCounts.length));
    return parts.slice(start, end).join(" ");
  });
  let cursor = 0;
  return groups.map((text, index) => {
    const durationMs = frameCounts[index] * MOCK_VIDEO_FRAME_MS;
    const scene: CreatorVideoScene = {
      id: crypto.randomUUID(), sceneNumber: index + 1,
      title: index === 0 ? script.title : `Scene ${index + 1}`,
      narrationText: text.slice(0, 1000),
      visualPrompt: `Create a clear editorial visual for: ${text.slice(0, 500)}`,
      visualType: index === 0 ? "title" : index === groups.length - 1 ? "outro" : "text",
      startTimeMs: cursor, durationMs, transition: index === 0 ? "cut" : "fade", status: "planned",
    };
    cursor += durationMs;
    return scene;
  });
}

export interface SceneSourceHashInput {
  title: string;
  narrationText: string;
  visualPrompt: string;
  visualType: string;
  durationMs: number;
  transition: string;
}

const encoder = new TextEncoder();

function field(value: string): string {
  return `${encoder.encode(value).byteLength}:${value}`;
}

export function canonicalVideoSceneSource(scene: SceneSourceHashInput): string {
  return `v1|${field(scene.title)}|${field(scene.narrationText)}|${field(scene.visualPrompt)}|${field(scene.visualType)}|${field(String(scene.durationMs))}|${field(scene.transition)}`;
}

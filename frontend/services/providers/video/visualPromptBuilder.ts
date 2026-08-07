import { VideoProviderError, type VideoRenderSceneInput } from "./videoProviderTypes";

const MAX_PROJECT_TITLE_CHARACTERS = 200;
const MAX_SCENE_TITLE_CHARACTERS = 200;
const MAX_VISUAL_PROMPT_CHARACTERS = 2_000;

function validText(value: string, maximum: number): boolean {
  return value.trim().length > 0 && value.length <= maximum && !/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

export function buildGeminiVisualPrompt(projectTitle: string, scene: VideoRenderSceneInput): string {
  if (!validText(projectTitle, MAX_PROJECT_TITLE_CHARACTERS)
    || !validText(scene.title, MAX_SCENE_TITLE_CHARACTERS)
    || !validText(scene.visualPrompt, MAX_VISUAL_PROMPT_CHARACTERS)) {
    throw new VideoProviderError("invalid_prompt", "The approved scene visual prompt is invalid.", false);
  }
  return [
    "Create exactly one cinematic image for a YouTube video scene.",
    `Project context: ${projectTitle}`,
    `Scene context: ${scene.title}`,
    "Preserve the approved scene intent exactly; do not replace its subject, action, setting, or mood.",
    "Approved scene intent:",
    scene.visualPrompt,
    "Compose a clean, single 16:9 frame with one coherent viewpoint.",
    "Do not create multiple panels, split screens, contact sheets, or collages.",
    "Do not add captions, watermarks, logos, interface frames, or other text unless the approved scene intent explicitly requires it.",
  ].join("\n");
}

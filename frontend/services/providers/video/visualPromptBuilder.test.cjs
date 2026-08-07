/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { buildGeminiVisualPrompt } = require("./visualPromptBuilder.ts");

function scene(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sceneNumber: 1,
    title: "A quiet launch",
    narrationText: "Internal narration should not be copied into the image prompt.",
    visualPrompt: "A paper rocket lifting from a moonlit desk, painterly and hopeful.",
    visualType: "image",
    durationMs: 2_000,
    transition: "cut",
    ...overrides,
  };
}

test("prompt preserves approved intent and requests one clean cinematic 16:9 scene", () => {
  const approved = "A paper rocket lifting from a moonlit desk, painterly and hopeful.";
  const prompt = buildGeminiVisualPrompt("Launch story", scene({ visualPrompt: approved }));
  assert.match(prompt, /exactly one cinematic image/i);
  assert.match(prompt, /single 16:9 frame/i);
  assert.match(prompt, /multiple panels.*collages/i);
  assert.match(prompt, /captions, watermarks, logos, interface frames/i);
  assert.ok(prompt.includes(approved));
  assert.doesNotMatch(prompt, /11111111|CreatorOS|sceneNumber|scene_id/i);
  assert.doesNotMatch(prompt, /Internal narration/);
});

test("prompt permits text only when the approved intent explicitly asks for it", () => {
  const prompt = buildGeminiVisualPrompt("Typography", scene({
    visualPrompt: "A clean title card containing the exact words Keep Going.",
  }));
  assert.match(prompt, /unless the approved scene intent explicitly requires it/i);
  assert.match(prompt, /exact words Keep Going/);
});

test("invalid, oversized, or control-character prompts fail without echoing content", () => {
  for (const visualPrompt of [" ", "a".repeat(2_001), "unsafe\0prompt"]) {
    assert.throws(() => buildGeminiVisualPrompt("Project", scene({ visualPrompt })), (error) => {
      assert.equal(error.code, "invalid_prompt");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, /unsafe|aaaa/);
      return true;
    });
  }
});

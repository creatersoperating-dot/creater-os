import { addMessage } from "./memory/conversationMemory";
import { buildContext } from "../context/contextEngine";
import { buildPrompt } from "../prompts/promptBuilder";
import { runAI } from "../router";
import type { ExecuteTaskRequest } from "../tasks/taskTypes";

export async function executeBrain(
  request: ExecuteTaskRequest
) {
  const context = await buildContext(request);

  const prompt = buildPrompt(
    request,
    context
  );

  addMessage(request.sessionId, {
    role: "user",
    content: request.input,
  });

  const result = await runAI({
    provider: "gemini",
    prompt,
  });

  void Promise.resolve(result.text).then(
    (text) => {
      addMessage(request.sessionId, {
        role: "assistant",
        content: text,
      });
    },
    (error) => {
      console.error(
        "Failed to save AI response to conversation memory:",
        error
      );
    }
  );

  return result;
}

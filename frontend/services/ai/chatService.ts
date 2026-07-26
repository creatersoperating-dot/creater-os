import { runAI } from "./router";

export async function chat(message: string) {
  return runAI({
    provider: "gemini",
    prompt: message,
  });
}
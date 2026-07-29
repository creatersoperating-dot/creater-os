import { streamText } from "ai";
import { google } from "@ai-sdk/google";

export async function runGemini(prompt: string) {
  return streamText({
    model: google("gemini-3-flash-preview"),
    prompt,
  });
}

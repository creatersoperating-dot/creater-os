import { streamText } from "ai";
import { google } from "@ai-sdk/google";

export async function runGemini(prompt: string) {
  console.log(
    "GOOGLE_GENERATIVE_AI_API_KEY loaded:",
    !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );

  return streamText({
    model: google("gemini-3-flash-preview"),
    prompt,
  });
}
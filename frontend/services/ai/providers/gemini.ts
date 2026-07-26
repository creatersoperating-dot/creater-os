import { streamText } from "ai";
import { google } from "@ai-sdk/google";

import { Brand } from "@/types/brand";
import { buildBrandContext } from "../brain/brandBrain";

export async function runGemini(
  prompt: string,
  brand: Brand
) {
  console.log(
    "GOOGLE_GENERATIVE_AI_API_KEY loaded:",
    !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );

  const systemPrompt = buildBrandContext(brand);

  return streamText({
    model: google("gemini-3-flash-preview"),
    system: systemPrompt,
    prompt,
  });
}
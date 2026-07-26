import { Brand } from "@/types/brand";
import { buildPrompt } from "./promptBuilder";

export function buildScriptPrompt(
  brand: Brand,
  topic: string
) {
  return buildPrompt(
    brand,
    `Create a YouTube script about ${topic}.`
  );
}
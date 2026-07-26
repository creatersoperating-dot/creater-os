import { Brand } from "@/types/brand";
import { buildScriptPrompt } from "../scriptService";
import { runAI } from "../providers/router";

export async function generateScript(
  brand: Brand,
  topic: string
) {
  const prompt = buildScriptPrompt(
    brand,
    topic
  );

  return runAI({
    provider: "openai",
    prompt,
  });
}
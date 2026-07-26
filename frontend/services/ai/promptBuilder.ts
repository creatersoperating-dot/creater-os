import { Brand } from "@/types/brand";
import { buildBrainContext } from "@/lib/brain/brainContext";

export function buildPrompt(
  brand: Brand,
  task: string
): string {
  const context = buildBrainContext(brand);

  return `
You are an expert creator strategist.

${context}

----------------------------

TASK

${task}

----------------------------

Follow all brand rules.

Respond only with the requested output.
`;
}
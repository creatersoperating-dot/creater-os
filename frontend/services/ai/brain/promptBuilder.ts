import { Brand } from "@/types/brand";

import { buildSystemPrompt } from "./systemPrompt";
import { buildBrandContext } from "./brandBrain";

interface PromptBuilderInput {
  brand: Brand;
  userPrompt: string;
}

export function buildPrompt({
  brand,
  userPrompt,
}: PromptBuilderInput) {
  return {
    system: `
${buildSystemPrompt()}

${buildBrandContext(brand)}
`,
    prompt: userPrompt,
  };
}
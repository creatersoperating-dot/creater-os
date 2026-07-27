import { Brand } from "@/types/brand";

import { buildSystemPrompt } from "./systemPrompt";
import { buildBrandContext } from "./brandBrain";
import { ConversationMessage } from "./memory/conversationMemory";

interface PromptBuilderInput {
  brand: Brand;
  userPrompt: string;
  history?: ConversationMessage[];
}

export function buildPrompt({
  brand,
  userPrompt,
  history = [],
}: PromptBuilderInput) {
  const conversation = history
    .map(
      (message) =>
        `${message.role.toUpperCase()}: ${message.content}`
    )
    .join("\n");

  return {
    system: `
${buildSystemPrompt()}

${buildBrandContext(brand)}
`,
    prompt: `
Previous Conversation:

${conversation}

Current User Message:

${userPrompt}
`,
  };
}
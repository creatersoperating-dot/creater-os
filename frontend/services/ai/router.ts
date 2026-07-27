import { Brand } from "@/types/brand";
import { runGemini } from "./providers/gemini";

export type AIProvider =
  | "openai"
  | "gemini"
  | "anthropic";

export interface AIRequest {
  provider: AIProvider;
  prompt: string;
  brand: Brand;
  sessionId: string;
}

export async function runAI(request: AIRequest) {
  switch (request.provider) {
    case "gemini":
      return runGemini(
        request.prompt,
        request.brand,
        request.sessionId
      );

    case "openai":
      throw new Error("OpenAI provider not implemented yet.");

    case "anthropic":
      throw new Error("Anthropic provider not implemented yet.");

    default:
      throw new Error("Unknown AI provider.");
  }
}
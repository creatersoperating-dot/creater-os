import { streamText } from "ai";
import { google } from "@ai-sdk/google";

import { Brand } from "@/types/brand";
import { buildPrompt } from "../brain/promptBuilder";
import {
  getConversation,
  addMessage,
} from "../brain/memory/conversationMemory";

export async function runGemini(
  prompt: string,
  brand: Brand,
  sessionId: string
) {
  const history = getConversation(sessionId);

  const aiPrompt = buildPrompt({
    brand,
    userPrompt: prompt,
    history,
  });

  // Save the user's message
  addMessage(sessionId, {
    role: "user",
    content: prompt,
  });

  const result = streamText({
    model: google("gemini-3-flash-preview"),
    system: aiPrompt.system,
    prompt: aiPrompt.prompt,
  });
    // Generate complete text
  const text = await result.text;

  // Save AI response
  addMessage(sessionId, {
    role: "assistant",
    content: text,
  });

  return result;
}
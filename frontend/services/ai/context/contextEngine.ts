import type { Brand } from "@/types/brand";
import {
  getConversation,
  type ConversationMessage,
} from "../brain/memory/conversationMemory";
import type { Capability } from "../capabilities/capabilities";
import type { ExecuteTaskRequest } from "../tasks/taskTypes";

export interface AIContext {
  brand: Brand;
  capability: Capability;
  sessionId: string;
  history: ConversationMessage[];
}

export async function buildContext(
  request: ExecuteTaskRequest
): Promise<AIContext> {
  return {
    brand: request.brand,
    capability: request.capability,
    sessionId: request.sessionId,
    history: [...getConversation(request.sessionId)],
  };
}

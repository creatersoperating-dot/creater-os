export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

const conversations = new Map<string, ConversationMessage[]>();

export function getConversation(
  sessionId: string
): ConversationMessage[] {
  return conversations.get(sessionId) ?? [];
}

export function addMessage(
  sessionId: string,
  message: ConversationMessage
) {
  const history = conversations.get(sessionId) ?? [];

  history.push(message);

  // Keep only the last 20 messages
  if (history.length > 20) {
    history.shift();
  }

  conversations.set(sessionId, history);
}

export function clearConversation(
  sessionId: string
) {
  conversations.delete(sessionId);
}
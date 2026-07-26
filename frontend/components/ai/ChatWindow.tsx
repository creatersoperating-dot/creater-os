"use client";

import { useState } from "react";

import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import TypingIndicator from "./TypingIndicator";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  async function sendMessage(message: string) {
    console.log("✅ sendMessage called");
    console.log("Message:", message);

    // Show user message immediately
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: message,
      },
    ]);

    setLoading(true);

    try {
      console.log("➡️ Calling /api/chat...");

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
        }),
      });

      console.log("⬅️ Status:", response.status);

      const text = await response.text();

      console.log("📨 Response:", text);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: text,
        },
      ]);
    } catch (error) {
      console.error("❌ Error:", error);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, something went wrong while contacting Gemini.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-100 rounded-2xl p-6">
      <div className="space-y-4 min-h-[400px] overflow-y-auto">
        {messages.map((message, index) => (
          <ChatMessage
            key={index}
            role={message.role}
            content={message.content}
          />
        ))}

        {loading && <TypingIndicator />}
      </div>

      <ChatInput onSend={sendMessage} />
    </div>
  );
}
"use client";

import { useEffect, useState } from "react";

import { Brand } from "@/types/brand";

import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import TypingIndicator from "./TypingIndicator";

interface ChatWindowProps {
  brand: Brand;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatWindow({
  brand,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const existing = localStorage.getItem("creatoros-session");

    if (existing) {
      setSessionId(existing);
      return;
    }

    const id = crypto.randomUUID();

    localStorage.setItem("creatoros-session", id);

    setSessionId(id);
  }, []);

  async function sendMessage(message: string) {
    console.log("✅ sendMessage called");
    console.log("Brand:", brand.name);
    console.log("Message:", message);
    console.log("Session:", sessionId);

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
          brand,
          sessionId,
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
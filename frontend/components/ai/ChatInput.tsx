    "use client";

import { useState } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
}

export default function ChatInput({
  onSend,
}: ChatInputProps) {
  const [message, setMessage] = useState("");

  function send() {
    if (!message.trim()) return;

    onSend(message);

    setMessage("");
  }

  return (
    <div className="flex gap-3 mt-6">

      <input
        className="flex-1 border rounded-xl p-4"
        placeholder="Ask CreatorOS..."
        value={message}
        onChange={(e) =>
          setMessage(e.target.value)
        }
      />

      <button
        onClick={send}
        className="bg-blue-600 text-white px-6 rounded-xl"
      >
        Send
      </button>

    </div>
  );
}   
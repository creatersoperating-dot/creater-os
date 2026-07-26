interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
}

export default function ChatMessage({
  role,
  content,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div
      className={`flex ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-2xl rounded-2xl px-5 py-3 ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-white shadow"
        }`}
      >
        {content}
      </div>
    </div>
  );
}
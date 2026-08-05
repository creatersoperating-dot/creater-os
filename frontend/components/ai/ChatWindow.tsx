"use client";

import { MessageSquare, Send } from "lucide-react";
import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { Brand } from "@/types/brand";

import ChatMessage from "./ChatMessage";
import TypingIndicator from "./TypingIndicator";

interface ChatWindowProps {
  brand: Brand;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

function getOrCreateSessionId(): string {
  const storageKey = "creatoros-session";
  const existing = window.localStorage.getItem(storageKey);

  if (existing) {
    return existing;
  }

  const id = window.crypto.randomUUID();
  window.localStorage.setItem(storageKey, id);

  return id;
}

export default function ChatWindow({
  brand,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const loadingRef = useRef(false);


  async function sendMessage(message: string) {
    const normalizedMessage = message.trim();

    if (!normalizedMessage || loadingRef.current) {
      return;
    }

    const sessionId = getOrCreateSessionId();

    loadingRef.current = true;
    setLoading(true);
    setDraft("");

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: normalizedMessage,
      },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: normalizedMessage,
          brand,
          sessionId,
        }),
      });

      const text = await response.text();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: text,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, something went wrong while contacting Gemini.",
        },
      ]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function handleComposerSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleComposerKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();

    if (!draft.trim() || loadingRef.current) {
      return;
    }

    void sendMessage(draft);
  }

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_45px_-28px_rgba(15,23,42,0.45)]">
      <div className="min-h-[420px] max-h-[640px] space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] p-4 sm:p-6 lg:p-8">
        {messages.length === 0 && !loading ? (
          <div className="flex min-h-[360px] items-center justify-center text-center">
            <div className="max-w-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-900 text-indigo-200 shadow-lg shadow-slate-900/20">
                <MessageSquare
                  className="h-7 w-7"
                  aria-hidden="true"
                />
              </div>
              <p className="mt-5 text-lg font-bold tracking-tight text-slate-900">
                Start a brand-aware conversation
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Ask for ideas, feedback, or help using the current
                brand context.
              </p>
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <ChatMessage
              key={index}
              role={message.role}
              content={message.content}
            />
          ))
        )}

        {loading && <TypingIndicator />}
      </div>

      <form
        onSubmit={handleComposerSubmit}
        className="border-t border-slate-200 bg-white p-3 sm:p-5"
      >
        <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/70 p-2.5 shadow-inner shadow-slate-100 transition focus-within:border-indigo-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-100">
          <label htmlFor="brand-chat-message" className="sr-only">
            Message
          </label>
          <textarea
            id="brand-chat-message"
            rows={2}
            value={draft}
            disabled={loading}
            placeholder="Ask CreatorOS about this brand…"
            className="max-h-48 min-h-16 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 px-1 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] font-medium text-slate-400">
              Enter to send · Shift + Enter for a new line
            </p>
            <button
              type="submit"
              disabled={!draft.trim() || loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/20 transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none sm:w-auto"
              aria-label="Send message"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Send message
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

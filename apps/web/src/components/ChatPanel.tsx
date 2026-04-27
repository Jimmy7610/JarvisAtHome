"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// localStorage key for chat history
const STORAGE_KEY = "jarvis.chat.v1";

const DEFAULT_GREETING: ChatMessage = {
  role: "assistant",
  text: "Hello. I am Jarvis — your local AI assistant. Type a message below to get started.",
};

// Read saved messages from localStorage.
// Returns null if localStorage is unavailable (SSR) or the stored value is invalid.
function loadMessages(): ChatMessage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as ChatMessage[];
  } catch {
    return null;
  }
}

// Persist messages to localStorage.
// Silent no-op in SSR or if storage is unavailable (e.g. private mode quota).
function saveMessages(messages: ChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // Storage quota exceeded or blocked — not fatal, just skip saving
  }
}

export default function ChatPanel() {
  // Lazy initialiser: load from localStorage on first render, fall back to greeting
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadMessages();
    return saved && saved.length > 0 ? saved : [DEFAULT_GREETING];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  // Scroll to latest message whenever the list changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const clearChat = () => {
    if (!window.confirm("Clear all chat history? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    setMessages([DEFAULT_GREETING]);
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    // Append the user message immediately
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        message: string;
        error?: string;
      };

      if (data.ok && data.message) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: data.message },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "error",
            text: data.error ?? "Something went wrong. Please try again.",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "error",
          text: "Could not reach the Jarvis API. Is it running on port 4000?",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Allow Shift+Enter for newlines; Enter alone submits
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(e as unknown as FormEvent);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Chat</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Non-streaming · Ollama · local only
          </p>
        </div>
        <button
          onClick={clearChat}
          disabled={loading}
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Clear chat history"
        >
          Clear chat
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, i) => {
          if (msg.role === "user") return <UserMessage key={i} text={msg.text} />;
          if (msg.role === "error") return <ErrorMessage key={i} text={msg.text} />;
          return <AssistantMessage key={i} text={msg.text} />;
        })}

        {/* Thinking indicator */}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0 text-cyan-400 text-xs font-bold">
              J
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60 px-4 py-3">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form onSubmit={send} className="px-6 py-4 border-t border-slate-800">
        <div className="flex gap-3 items-end">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={loading ? "Waiting for Jarvis…" : "Message Jarvis…"}
            disabled={loading}
            className="flex-1 resize-none rounded-lg bg-slate-800/60 border border-slate-700 px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          />
          <button
            type="submit"
            disabled={loading || input.trim() === ""}
            className="px-4 py-3 rounded-lg bg-cyan-500/20 text-cyan-400 text-sm font-medium border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
        <p className="text-xs text-slate-700 mt-2 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </form>
    </div>
  );
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0 text-cyan-400 text-xs font-bold">
        J
      </div>
      <div className="flex-1">
        <p className="text-xs text-cyan-400 font-medium mb-1">Jarvis</p>
        <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 px-4 py-3 text-sm text-slate-300 whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3 justify-end">
      <div className="max-w-[75%]">
        <p className="text-xs text-slate-500 font-medium mb-1 text-right">You</p>
        <div className="rounded-lg bg-slate-700/60 border border-slate-600/60 px-4 py-3 text-sm text-slate-200 whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </div>
  );
}

function ErrorMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center flex-shrink-0 text-red-400 text-xs font-bold">
        !
      </div>
      <div className="flex-1">
        <p className="text-xs text-red-400 font-medium mb-1">Error</p>
        <div className="rounded-lg bg-red-900/20 border border-red-700/40 px-4 py-3 text-sm text-red-300">
          {text}
        </div>
      </div>
    </div>
  );
}

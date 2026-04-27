"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
}

// Shape expected by the API history field
interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// localStorage key for chat history
const STORAGE_KEY = "jarvis.chat.v1";

const DEFAULT_GREETING: ChatMessage = {
  role: "assistant",
  text: "Hello. I am Jarvis — your local AI assistant. Type a message below to get started.",
};

// Maximum number of history turns to send to the API
const HISTORY_LIMIT = 12;

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

// Build the history array to send to the API from the current message list.
// Excludes:
//   - the default UI greeting (not a real model response)
//   - error bubbles
//   - empty assistant placeholders (mid-stream)
// Returns the last HISTORY_LIMIT valid user/assistant turns.
function buildHistory(messages: ChatMessage[]): HistoryMessage[] {
  return messages
    .filter((m) => m.text !== DEFAULT_GREETING.text)
    .filter((m) => m.role !== "error")
    .filter((m) => !(m.role === "assistant" && m.text === ""))
    .filter((m): m is ChatMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
    )
    .map((m) => ({ role: m.role, content: m.text }))
    .slice(-HISTORY_LIMIT);
}

export default function ChatPanel() {
  // Lazy initialiser: load from localStorage on first render, fall back to greeting
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadMessages();
    return saved && saved.length > 0 ? saved : [DEFAULT_GREETING];
  });
  const [input, setInput] = useState("");
  // loading: true from send until the stream ends (or errors)
  const [loading, setLoading] = useState(false);
  // streaming: true once the first token has arrived (thinking dots hidden, text visible)
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Persist to localStorage only when loading finishes, not on every token update.
  // This avoids dozens of writes per streaming response.
  useEffect(() => {
    if (!loading) {
      saveMessages(messages);
    }
  }, [loading, messages]);

  // Scroll to latest message whenever the list or loading state changes
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

    // Capture history from current messages before the new user turn is added
    const history = buildHistory(messages);

    // Show user message immediately
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);
    setStreaming(false);

    try {
      const res = await fetch(`${API_URL}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`API returned HTTP ${res.status}`);
      }

      // Add an empty assistant bubble — we'll fill it in as tokens arrive
      setMessages((prev) => [...prev, { role: "assistant", text: "" }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let errorText: string | null = null;
      // Local flag avoids relying on stale closure value of `streaming` state
      let firstTokenReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Each chunk from the API is one JSON line terminated with \n
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const chunk = JSON.parse(line) as
            | { type: "token"; content: string }
            | { type: "done"; model: string }
            | { type: "error"; error: string };

          if (chunk.type === "token") {
            // Switch from thinking dots to growing text bubble on the first token
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              setStreaming(true);
            }

            // Append token to the last message in-place
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              updated[updated.length - 1] = {
                ...last,
                text: last.text + chunk.content,
              };
              return updated;
            });
          } else if (chunk.type === "error") {
            errorText = chunk.error;
          }
          // "done" chunk carries the model name — nothing extra to do
        }
      }

      // If Ollama reported an error mid-stream, replace the empty bubble with an error
      if (errorText) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant" && last.text === "") {
            updated[updated.length - 1] = { role: "error", text: errorText! };
          }
          return updated;
        });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Could not reach the Jarvis API. Is it running on port 4000?";

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        // If the empty assistant bubble was already added, convert it to an error
        if (last.role === "assistant" && last.text === "") {
          updated[updated.length - 1] = { role: "error", text: msg };
        } else {
          updated.push({ role: "error", text: msg });
        }
        return updated;
      });
    } finally {
      setLoading(false);
      setStreaming(false);
    }
  };

  // Allow Shift+Enter for newlines; Enter alone submits
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(e as unknown as FormEvent);
    }
  };

  // Show thinking dots only while loading and before the first token arrives
  const showThinking = loading && !streaming;

  // Context count shown in the header — computed from the current message list
  const contextCount = buildHistory(messages).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Chat</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Streaming · Ollama ·{" "}
            <span className="text-slate-600">
              context: {contextCount} msg{contextCount !== 1 ? "s" : ""}
            </span>
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
          // Show a blinking cursor on the last assistant message while streaming
          const isLast = i === messages.length - 1;
          return (
            <AssistantMessage
              key={i}
              text={msg.text}
              showCursor={streaming && isLast}
            />
          );
        })}

        {/* Thinking indicator — visible from send until the first token arrives */}
        {showThinking && (
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
            placeholder={loading ? "Jarvis is responding…" : "Message Jarvis…"}
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

function AssistantMessage({
  text,
  showCursor,
}: {
  text: string;
  showCursor?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0 text-cyan-400 text-xs font-bold">
        J
      </div>
      <div className="flex-1">
        <p className="text-xs text-cyan-400 font-medium mb-1">Jarvis</p>
        <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 px-4 py-3 text-sm text-slate-300 whitespace-pre-wrap">
          {text}
          {/* Blinking cursor while tokens are arriving */}
          {showCursor && (
            <span className="inline-block w-0.5 h-3.5 bg-cyan-400 ml-0.5 align-middle animate-pulse" />
          )}
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

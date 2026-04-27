"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

interface ChatMessage {
  role: "user" | "assistant" | "error" | "cancelled";
  text: string;
}

// Shape expected by the API history field
interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

// Shape of a message row returned by GET /sessions/:id
interface BackendMessage {
  id: number;
  session_id: number;
  role: "user" | "assistant" | "error" | "cancelled";
  content: string;
  model: string | null;
  created_at: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// localStorage key for chat history
const STORAGE_KEY = "jarvis.chat.v1";
// localStorage key for the active backend session id
const SESSION_STORAGE_KEY = "jarvis.session.v1";

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
//   - cancelled bubbles
//   - empty assistant placeholders (mid-stream)
// Returns the last HISTORY_LIMIT valid user/assistant turns.
function buildHistory(messages: ChatMessage[]): HistoryMessage[] {
  return messages
    .filter((m) => m.text !== DEFAULT_GREETING.text)
    .filter((m) => m.role !== "error")
    .filter((m) => m.role !== "cancelled")
    .filter((m) => !(m.role === "assistant" && m.text === ""))
    .filter((m): m is ChatMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
    )
    .map((m) => ({ role: m.role, content: m.text }))
    .slice(-HISTORY_LIMIT);
}

// --- Backend session persistence helpers ---
// These are module-level functions so they can reference the module-level API_URL constant.

// Load the active backend session id from localStorage.
function loadSessionId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const id = parseInt(raw, 10);
    return isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

// Persist the active backend session id to localStorage.
function saveSessionId(id: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, String(id));
  } catch {
    // Storage quota exceeded — not fatal
  }
}

// Create a new backend session and return its id.
// Returns null if the backend is unreachable — callers degrade gracefully.
async function createSession(): Promise<number | null> {
  try {
    const res = await fetch(`${API_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Jarvis Chat" }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      session?: { id: number };
    };
    if (!data.ok || !data.session?.id) return null;
    saveSessionId(data.session.id);
    return data.session.id;
  } catch {
    return null;
  }
}

// Fire-and-forget: persist one message to the backend.
// Never throws — failures are logged as console.warn only.
async function persistMessage(
  sessionId: number,
  role: "user" | "assistant" | "error" | "cancelled",
  content: string,
  model?: string
): Promise<void> {
  try {
    await fetch(`${API_URL}/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content, model }),
    });
  } catch (err) {
    console.warn("[Jarvis] Failed to persist message to backend:", err);
  }
}

// Fire-and-forget: update session title via PATCH /sessions/:id.
// Used to auto-title a session from the first user message.
async function updateSessionTitle(
  sessionId: number,
  title: string
): Promise<void> {
  try {
    await fetch(`${API_URL}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  } catch {
    // Not critical — ignore silently
  }
}

// Load chat history from the backend for a given session.
// Returns the mapped messages on success, null if the backend is unreachable, the session
// is gone, or the session has no messages yet.
async function loadSessionFromBackend(
  sessionId: number
): Promise<ChatMessage[] | null> {
  try {
    const res = await fetch(`${API_URL}/sessions/${sessionId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      messages?: BackendMessage[];
    };
    if (!data.ok || !Array.isArray(data.messages)) return null;
    const msgs: ChatMessage[] = data.messages.map((m) => ({
      role: m.role,
      text: m.content,
    }));
    // Treat an empty message list the same as "nothing from backend"
    return msgs.length > 0 ? msgs : null;
  } catch (err) {
    console.warn("[Jarvis] Failed to load history from backend:", err);
    return null;
  }
}

export default function ChatPanel() {
  // Start with the greeting on every render (matches server-rendered HTML).
  // localStorage is loaded after mount in a useEffect below.
  // This two-phase pattern prevents Next.js hydration mismatches.
  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_GREETING]);
  const [input, setInput] = useState("");
  // loading: true from send until the stream ends (or errors or is cancelled)
  const [loading, setLoading] = useState(false);
  // streaming: true once the first token has arrived (thinking dots hidden, text visible)
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Holds the active AbortController so the Stop button can cancel it
  const abortControllerRef = useRef<AbortController | null>(null);
  // Holds the active backend session id once ensureSession resolves
  const sessionIdRef = useRef<number | null>(null);
  // "backend" = history loaded from SQLite; "local" = localStorage or default
  const [historySource, setHistorySource] = useState<
    "backend" | "local" | null
  >(null);

  // Load chat history after mount — backend is preferred, localStorage is the fallback.
  // Must run after mount (not during render) to avoid server/client HTML mismatch.
  useEffect(() => {
    const existingId = loadSessionId();

    if (existingId !== null) {
      // Session id stored — try to restore from backend first.
      sessionIdRef.current = existingId;
      loadSessionFromBackend(existingId).then((backendMessages) => {
        if (backendMessages !== null) {
          // Backend has history — use it and sync to localStorage as cache.
          setMessages(backendMessages);
          saveMessages(backendMessages);
          setHistorySource("backend");
        } else {
          // Backend unavailable or session has no messages — fall back to localStorage.
          const saved = loadMessages();
          if (saved && saved.length > 0) {
            setMessages(saved);
          }
          setHistorySource("local");
        }
      });
    } else {
      // No session id yet — use localStorage for initial state, create session in background.
      const saved = loadMessages();
      if (saved && saved.length > 0) {
        setMessages(saved);
      }
      setHistorySource("local");
      createSession().then((id) => {
        sessionIdRef.current = id;
      });
    }
  }, []);

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

  // Abort any in-flight streaming request when the component unmounts (e.g. session switch).
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const clearChat = () => {
    if (!window.confirm("Clear all chat history? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    setMessages([DEFAULT_GREETING]);
  };

  // Cancel the active streaming request. Partial text is preserved.
  const cancel = () => {
    abortControllerRef.current?.abort();
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    // Capture history from current messages before the new user turn is added
    const history = buildHistory(messages);
    // Detect first user message so we can auto-title the session afterwards
    const isFirstUserMessage = !messages.some((m) => m.role === "user");

    // Show user message immediately
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);
    setStreaming(false);

    // Create a fresh AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Snapshot the session id before any await so it stays consistent for this send
    const sid = sessionIdRef.current;
    // Persist user message and, on the first message, auto-title the session
    if (sid !== null) {
      void persistMessage(sid, "user", trimmed);
      if (isFirstUserMessage) {
        void updateSessionTitle(sid, trimmed.slice(0, 50));
      }
    }

    // Track accumulated assistant text and model locally for persistence after streaming
    let assistantText = "";
    let modelName: string | undefined;

    try {
      const res = await fetch(`${API_URL}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
        signal: controller.signal,
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

            // Accumulate text locally so we can persist the full response later
            assistantText += chunk.content;
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
          } else if (chunk.type === "done") {
            // Capture model name so we can include it when persisting the assistant message
            modelName = chunk.model;
          }
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
        // Persist error bubble
        if (sid !== null) {
          void persistMessage(sid, "error", errorText);
        }
      } else if (assistantText && sid !== null) {
        // Persist successful assistant response with model name if known
        void persistMessage(sid, "assistant", assistantText, modelName);
      }
    } catch (err: unknown) {
      // User-initiated abort — not an error
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          // Only replace the bubble if no text arrived yet — otherwise keep partial text
          if (last.role === "assistant" && last.text === "") {
            updated[updated.length - 1] = {
              role: "cancelled",
              text: "Response cancelled.",
            };
          }
          return updated;
        });
        // Persist partial text if tokens arrived, otherwise the cancelled marker
        if (sid !== null) {
          if (assistantText) {
            void persistMessage(sid, "assistant", assistantText, modelName);
          } else {
            void persistMessage(sid, "cancelled", "Response cancelled.");
          }
        }
        return;
      }

      // Real network or API error — show error bubble
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
      // Persist error message
      if (sid !== null) {
        void persistMessage(sid, "error", msg);
      }
    } finally {
      abortControllerRef.current = null;
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
            {historySource && (
              <span className="text-slate-700">
                {" · "}history: {historySource}
              </span>
            )}
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
          if (msg.role === "cancelled") return <CancelledMessage key={i} />;
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

          {/* Stop button — always rendered to prevent layout shift; invisible when idle */}
          <button
            type="button"
            onClick={cancel}
            aria-label="Stop response"
            className={`px-4 py-3 rounded-lg text-sm font-medium border transition-colors
              ${
                loading
                  ? "bg-slate-700/60 text-slate-300 border-slate-600/60 hover:bg-slate-700 hover:text-slate-100"
                  : "invisible pointer-events-none"
              }`}
          >
            Stop
          </button>

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

// Shown when the user cancelled a response before it fully arrived.
// Subtle — not a red error, just a muted note.
function CancelledMessage() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center flex-shrink-0 text-slate-600 text-xs select-none">
        ◼
      </div>
      <div className="flex-1 flex items-center">
        <span className="text-xs text-slate-600 italic">Response cancelled.</span>
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

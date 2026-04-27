"use client";

import { useState, useEffect, useRef } from "react";
import StatusPanel from "@/components/StatusPanel";
import ChatPanel from "@/components/ChatPanel";
import ActivityPanel, { type ActivityEvent } from "@/components/ActivityPanel";
import SessionList, { type SessionRow } from "@/components/SessionList";
import WorkspacePanel from "@/components/WorkspacePanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// localStorage keys (mirrored from ChatPanel — do not change independently)
const SESSION_KEY = "jarvis.session.v1";
const CHAT_CACHE_KEY = "jarvis.chat.v1";

// Initial activity events shown on page load (static — no SSR timestamp issues)
const INITIAL_ACTIVITIES: ActivityEvent[] = [
  { id: "init-3", time: "—", text: "Ollama status check active", type: "info" },
  { id: "init-2", time: "—", text: "API health check triggered", type: "info" },
  { id: "init-1", time: "—", text: "Dashboard loaded", type: "info" },
];

function readStoredSessionId(): number | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const id = parseInt(raw, 10);
    return isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

function writeStoredSessionId(id: number): void {
  try {
    localStorage.setItem(SESSION_KEY, String(id));
  } catch {}
}

export default function DashboardPage() {
  // The session id that ChatPanel is displaying.
  // Starts as null until the mount effect resolves (avoids hydration mismatch).
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  // Gates ChatPanel rendering until the session id is determined
  const [sessionReady, setSessionReady] = useState(false);
  // Guards against key-repeat creating multiple sessions while Ctrl+Shift+N is held
  const isCreatingNewChatRef = useRef(false);

  // Activity log — newest event first, capped at 50 entries
  const [activities, setActivities] = useState<ActivityEvent[]>(INITIAL_ACTIVITIES);

  function handleActivity(
    text: string,
    type: ActivityEvent["type"] = "info"
  ): void {
    const event: ActivityEvent = {
      id: `${Date.now()}-${Math.random()}`,
      time: new Date().toLocaleTimeString("en-US", { hour12: false }),
      text,
      type,
    };
    setActivities((prev) => [event, ...prev].slice(0, 50));
  }

  // File attachment — set by WorkspacePanel, consumed and cleared by ChatPanel
  const [attachment, setAttachment] = useState<{
    path: string;
    content: string;
    size: number;
  } | null>(null);

  // Prefilled chat input — set when the user clicks "Ask Jarvis about this file".
  // ChatPanel consumes it once (via onConsumePrefill) so it never fires twice.
  const [prefillInput, setPrefillInput] = useState<string | null>(null);

  function handleAttachFile(path: string, content: string, size: number): void {
    setAttachment({ path, content, size });
  }

  function handleClearAttachment(): void {
    setAttachment(null);
  }

  // Attaches the file AND queues a suggested question in the chat input.
  // Nothing is sent automatically — the user edits and presses Send.
  function handleAskAboutFile(
    path: string,
    content: string,
    size: number
  ): void {
    setAttachment({ path, content, size });
    setPrefillInput("Explain this file and suggest safe improvements.");
  }

  function handleConsumePrefill(): void {
    setPrefillInput(null);
  }

  // Fetch the session list from the backend and update state
  async function fetchSessions(): Promise<void> {
    try {
      const res = await fetch(`${API_URL}/sessions`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok: boolean;
        sessions?: SessionRow[];
      };
      if (data.ok && Array.isArray(data.sessions)) {
        setSessions(data.sessions);
      }
    } catch {
      // Backend unreachable — keep empty list, not fatal
    } finally {
      setSessionsLoading(false);
    }
  }

  // Create a new session on the backend and return its id. Returns null on failure.
  async function createNewSession(): Promise<number | null> {
    try {
      const res = await fetch(`${API_URL}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Jarvis Chat" }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        ok: boolean;
        session?: SessionRow;
      };
      if (!data.ok || !data.session?.id) return null;
      writeStoredSessionId(data.session.id);
      return data.session.id;
    } catch {
      return null;
    }
  }

  // On mount: determine the active session, then show ChatPanel and load sessions
  useEffect(() => {
    const storedId = readStoredSessionId();
    if (storedId !== null) {
      // Existing session — use it directly
      setActiveSessionId(storedId);
      setSessionReady(true);
      void fetchSessions();
    } else {
      // No stored session — create one before rendering ChatPanel
      createNewSession().then((id) => {
        if (id !== null) setActiveSessionId(id);
        setSessionReady(true);
        void fetchSessions();
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Global keyboard shortcut: Ctrl+Shift+N → new chat.
  // Ignored while the user is typing in any text field or rename input.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!e.ctrlKey || !e.altKey || e.key !== "n") return;

      // Do not fire while focus is inside a text field or rename input
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target.isContentEditable) return;

      e.preventDefault();

      // Guard against key-repeat (a held key fires continuous keydown events)
      if (isCreatingNewChatRef.current) return;
      isCreatingNewChatRef.current = true;
      void handleNewChat().finally(() => {
        isCreatingNewChatRef.current = false;
      });
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Switch to an existing session
  function handleSwitchSession(id: number): void {
    writeStoredSessionId(id);
    setActiveSessionId(id);
    // ChatPanel remounts via the key prop — it loads the new session's history automatically
  }

  // Delete a session by id. If it was the active session, create a replacement.
  async function handleDeleteSession(id: number): Promise<void> {
    try {
      const res = await fetch(`${API_URL}/sessions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.warn("Delete session: HTTP error", res.status);
        return;
      }
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        console.warn("Delete session failed:", data.error);
        return;
      }
    } catch (err) {
      console.warn("Delete session: request failed:", err);
      return;
    }

    // If the deleted session was active, create a fresh replacement session
    if (id === activeSessionId) {
      try {
        localStorage.removeItem(CHAT_CACHE_KEY);
      } catch {}
      const newId = await createNewSession();
      // setActiveSessionId with null is safe — ChatPanel renders null key which shows greeting
      setActiveSessionId(newId);
    }

    // Refresh the sidebar list regardless
    void fetchSessions();
  }

  // Rename a session title via PATCH /sessions/:id.
  // No chat reset, no session switch, no localStorage change.
  async function handleRenameSession(id: number, newTitle: string): Promise<void> {
    try {
      const res = await fetch(`${API_URL}/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!res.ok) {
        console.warn("Rename session: HTTP error", res.status);
        return;
      }
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        console.warn("Rename session failed:", data.error);
        return;
      }
    } catch (err) {
      console.warn("Rename session: request failed:", err);
      return;
    }
    // Refresh the sidebar so the new title is shown
    void fetchSessions();
  }

  // Create a new blank session and switch to it
  async function handleNewChat(): Promise<void> {
    const id = await createNewSession();
    if (id === null) return;
    // Clear the localStorage chat cache so the new session starts with the greeting
    try {
      localStorage.removeItem(CHAT_CACHE_KEY);
    } catch {}
    setActiveSessionId(id);
    // Refresh the sessions list so the new item appears in the sidebar
    void fetchSessions();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0e1a] text-slate-200">
      {/* Left sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-slate-800 bg-[#0d1120] flex flex-col">
        {/* Logo */}
        <div className="px-5 py-6 border-b border-slate-800">
          <h1 className="text-xl font-bold tracking-widest text-cyan-400 uppercase">
            Jarvis
          </h1>
          <p className="text-xs text-slate-500 mt-1">Local-first AI assistant</p>
        </div>

        {/* Navigation */}
        <nav className="px-3 py-4 space-y-1 border-b border-slate-800">
          <NavItem label="Dashboard" active />
          <NavItem label="Chat" />
          <NavItem label="Memory" disabled />
          <NavItem label="Files" disabled />
          <NavItem label="Settings" disabled />
        </nav>

        {/* Session list — flex-1 so it fills remaining sidebar space */}
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          loading={sessionsLoading}
          onNewChat={() => void handleNewChat()}
          onSelect={handleSwitchSession}
          onDelete={(id) => void handleDeleteSession(id)}
          onRename={(id, title) => void handleRenameSession(id, title)}
        />

        <div className="px-5 py-4 border-t border-slate-800 text-xs text-slate-600">
          v0.1.0 — skeleton
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Chat area — ChatPanel remounts when activeSessionId changes (key prop) */}
        <section className="flex-1 flex flex-col border-r border-slate-800">
          {sessionReady && (
            <ChatPanel
              key={activeSessionId ?? "new"}
              onSessionUpdated={() => void fetchSessions()}
              attachment={attachment}
              onClearAttachment={handleClearAttachment}
              prefillInput={prefillInput}
              onConsumePrefill={handleConsumePrefill}
              onActivity={handleActivity}
            />
          )}
        </section>

        {/* Right panel */}
        <aside className="w-72 flex-shrink-0 flex flex-col overflow-hidden">
          <StatusPanel />
          {/* ActivityPanel — flex flex-col so ActivityPanel's own flex-1 root fills the
              bounded height, which lets the inner overflow-y-auto list actually scroll */}
          <div className="flex-none flex flex-col overflow-hidden" style={{ height: "240px" }}>
            <ActivityPanel events={activities} />
          </div>

          {/* WorkspacePanel — flex-1 min-h-0 lets it fill remaining sidebar space
              and shrink below its natural content height so it never overflows */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <WorkspacePanel
              onAttachFile={handleAttachFile}
              onAskAboutFile={handleAskAboutFile}
              onActivity={handleActivity}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}

// Simple navigation item — no router dependency needed at this stage
function NavItem({
  label,
  active,
  disabled,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  const base = "w-full text-left px-3 py-2 rounded text-sm transition-colors";
  const styles = disabled
    ? `${base} text-slate-600 cursor-not-allowed`
    : active
    ? `${base} bg-cyan-500/10 text-cyan-400 font-medium`
    : `${base} text-slate-400 hover:bg-slate-800 hover:text-slate-200`;

  return (
    <button className={styles} disabled={disabled}>
      {label}
    </button>
  );
}

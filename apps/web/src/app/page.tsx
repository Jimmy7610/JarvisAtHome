"use client";

import { useState, useEffect, useRef } from "react";
import StatusPanel from "@/components/StatusPanel";
import ChatPanel from "@/components/ChatPanel";
import ActivityPanel, { type ActivityEvent } from "@/components/ActivityPanel";
import SessionList, { type SessionRow } from "@/components/SessionList";
import WorkspacePanel from "@/components/WorkspacePanel";
import ProjectLibraryPanel from "@/components/ProjectLibraryPanel";
import SettingsPanel from "@/components/SettingsPanel";
import MemoryPanel from "@/components/MemoryPanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// ── Types ─────────────────────────────────────────────────────────────────────

// Represents a memory note the user has opted-in to include in chat context.
// A subset of the full MemoryItem shape — only the fields needed for injection.
export interface MemoryContextItem {
  id: string;
  type: "preference" | "project" | "note";
  title: string;
  content: string;
}

// localStorage keys (mirrored from ChatPanel — do not change independently)
const SESSION_KEY = "jarvis.session.v1";
const CHAT_CACHE_KEY = "jarvis.chat.v1";
// localStorage key for the user's Ollama model override (set via Settings panel)
const OLLAMA_MODEL_KEY = "jarvis:selected-ollama-model";
// localStorage key for persisted selected memory context IDs.
// Only UUIDs are stored — full memory content stays in SQLite only.
const MEMORY_CONTEXT_IDS_KEY = "jarvis:selected-memory-context-ids";

// ── localStorage helpers for selected memory context IDs ─────────────────────
//
// Only IDs are persisted — never content.
// On restore, page.tsx fetches GET /memory and cross-references by ID.

function readStoredMemoryContextIds(): string[] {
  try {
    const raw = localStorage.getItem(MEMORY_CONTEXT_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Accept only string entries to guard against corrupted data
    return (parsed as unknown[]).filter(
      (v): v is string => typeof v === "string"
    );
  } catch {
    return [];
  }
}

function writeStoredMemoryContextIds(ids: string[]): void {
  try {
    localStorage.setItem(MEMORY_CONTEXT_IDS_KEY, JSON.stringify(ids));
  } catch {
    // Storage quota exceeded or unavailable — not fatal
  }
}

function clearStoredMemoryContextIds(): void {
  try {
    localStorage.removeItem(MEMORY_CONTEXT_IDS_KEY);
  } catch {}
}

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

  // Main view — switches the center area between Chat, Memory, and Settings.
  // Right sidebar is always visible regardless of which view is active.
  const [view, setView] = useState<"chat" | "memory" | "settings">("chat");

  // Ollama model override — null means use the backend-resolved default.
  // Persisted in localStorage under OLLAMA_MODEL_KEY.
  // Starts null; the mount effect below reads it from localStorage to avoid
  // hydration mismatches (same pattern as activeSessionId).
  const [selectedModelOverride, setSelectedModelOverride] =
    useState<string | null>(null);

  // Backend-configured default Ollama model name (e.g. "qwen2.5-coder:latest").
  // Fetched once from /settings on mount and used only for display in ChatPanel header.
  // Null while loading or if the API is unreachable — ChatPanel shows "default" label.
  const [defaultOllamaModel, setDefaultOllamaModel] =
    useState<string | null>(null);

  // Memory notes the user has opted-in to include in the next chat message.
  // Lives here so both MemoryPanel (toggle buttons) and ChatPanel (injection) share it.
  // Selection persists across view switches; never cleared automatically — only on
  // explicit user action (toggle off, clear all, or after each send if desired).
  const [selectedMemoryContext, setSelectedMemoryContext] = useState<
    MemoryContextItem[]
  >([]);

  // Right sidebar tab — which panel is currently shown.
  // Default "workspace" so file tools are immediately accessible.
  const [rightTab, setRightTab] = useState<
    "status" | "activity" | "workspace" | "projects"
  >("workspace");

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

  // Load model override from localStorage on mount (client-side only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(OLLAMA_MODEL_KEY);
      if (saved) setSelectedModelOverride(saved);
    } catch {
      // localStorage unavailable — ignore silently
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore selected memory context from localStorage on mount.
  //
  // We only store UUIDs in localStorage — full content stays in SQLite.
  // On restore we fetch GET /memory once to get current content, then
  // rebuild selectedMemoryContext for IDs that still exist in the database.
  // Stale IDs (from deleted memories) are silently removed from localStorage.
  //
  // This effect fires only when there are saved IDs to restore; it is a
  // silent restore and does NOT log to the Activity Log (not a user action).
  // If the API is unreachable on mount, selection starts empty and localStorage
  // IDs are preserved for the next page load.
  useEffect(() => {
    const savedIds = readStoredMemoryContextIds();
    if (savedIds.length === 0) return; // nothing to restore — skip the fetch

    fetch(`${API_URL}/memory`)
      .then((r) => r.json())
      .then(
        (d: {
          ok: boolean;
          memories?: {
            id: string;
            type: string;
            title: string;
            content: string;
          }[];
        }) => {
          if (!d.ok || !Array.isArray(d.memories)) return;

          const savedIdSet = new Set(savedIds);
          // Rebuild MemoryContextItem list for IDs that still exist in SQLite
          const restored: MemoryContextItem[] = d.memories
            .filter((m) => savedIdSet.has(m.id))
            .map((m) => ({
              id: m.id,
              type: m.type as MemoryContextItem["type"],
              title: m.title,
              content: m.content,
            }));

          if (restored.length > 0) {
            setSelectedMemoryContext(restored);
          }

          // Clean up stale IDs (deleted memories no longer in the database)
          if (restored.length !== savedIds.length) {
            if (restored.length === 0) {
              clearStoredMemoryContextIds();
            } else {
              writeStoredMemoryContextIds(restored.map((m) => m.id));
            }
          }
        }
      )
      .catch(() => {
        // API unreachable on mount — selection stays empty.
        // Saved IDs remain in localStorage for the next page load attempt.
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the backend-configured default Ollama model name once on mount.
  // Used purely for display in the ChatPanel header pill — no functional impact.
  // A failed fetch leaves defaultOllamaModel as null; ChatPanel shows "default" label.
  useEffect(() => {
    fetch(`${API_URL}/settings`)
      .then((r) => r.json())
      .then((d: { ok: boolean; ollama?: { defaultModel: string } }) => {
        if (d.ok && d.ollama?.defaultModel) {
          setDefaultOllamaModel(d.ollama.defaultModel);
        }
      })
      .catch(() => {
        // API unreachable — ChatPanel falls back to "default model" label
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by SettingsPanel when the user picks a model from the dropdown.
  function handleModelOverrideChange(model: string): void {
    try {
      localStorage.setItem(OLLAMA_MODEL_KEY, model);
    } catch {}
    setSelectedModelOverride(model);
    handleActivity(`Ollama model override set to ${model}`, "info");
  }

  // Called by SettingsPanel when the user clicks "Reset to default".
  function handleModelOverrideClear(): void {
    try {
      localStorage.removeItem(OLLAMA_MODEL_KEY);
    } catch {}
    setSelectedModelOverride(null);
    handleActivity("Ollama model override cleared — using default config", "info");
  }

  // Toggle a memory note in/out of the chat context selection.
  // If the note is already selected, remove it; otherwise add it.
  // Persists the new set of IDs to localStorage (content never stored there).
  // Activity events log the title only — content is never logged.
  function handleMemoryContextToggle(item: MemoryContextItem): void {
    setSelectedMemoryContext((prev) => {
      const exists = prev.some((m) => m.id === item.id);
      if (exists) {
        handleActivity(`Memory removed from context: ${item.title}`, "info");
        const next = prev.filter((m) => m.id !== item.id);
        // Persist updated IDs — remove the key when selection becomes empty
        if (next.length === 0) {
          clearStoredMemoryContextIds();
        } else {
          writeStoredMemoryContextIds(next.map((m) => m.id));
        }
        return next;
      } else {
        handleActivity(`Memory included in context: ${item.title}`, "info");
        const next = [...prev, item];
        writeStoredMemoryContextIds(next.map((m) => m.id));
        return next;
      }
    });
  }

  // Clear all selected memory notes from the chat context.
  // Also removes the persisted IDs from localStorage.
  function handleMemoryContextClear(): void {
    setSelectedMemoryContext([]);
    clearStoredMemoryContextIds();
    handleActivity("Memory context cleared", "info");
  }

  // Called by MemoryPanel after a memory note is successfully deleted.
  // If the deleted note was in the selected context, removes it from state
  // and updates localStorage immediately — no stale IDs left after delete.
  // No Activity Log event here (MemoryPanel already logs the delete).
  function handleMemoryDeleted(id: string): void {
    setSelectedMemoryContext((prev) => {
      const next = prev.filter((m) => m.id !== id);
      // Only touch localStorage if the deleted note was actually selected
      if (next.length !== prev.length) {
        if (next.length === 0) {
          clearStoredMemoryContextIds();
        } else {
          writeStoredMemoryContextIds(next.map((m) => m.id));
        }
      }
      return next;
    });
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

  // File path that WorkspacePanel should navigate to and preview.
  // Set by ChatPanel after a draft write is approved; consumed by WorkspacePanel.
  const [openFileRequest, setOpenFileRequest] = useState<string | null>(null);

  // Project Library file attached to chat — set by ProjectLibraryPanel, consumed by ChatPanel.
  // Cleared immediately by ChatPanel when it sends the message.
  const [attachedProjectFile, setAttachedProjectFile] = useState<{
    projectName: string;
    path: string;
    content: string;
    size: number;
  } | null>(null);

  function handleAttachProjectFile(
    projectName: string,
    filePath: string,
    content: string,
    size: number
  ): void {
    setAttachedProjectFile({ projectName, path: filePath, content, size });
    handleActivity(
      `Attached project file ${projectName}/${filePath} to chat`,
      "info"
    );
  }

  function handleClearAttachedProjectFile(): void {
    setAttachedProjectFile(null);
  }

  // Attaches the project file AND queues a suggested question in the chat input.
  // Mirrors the existing handleAskAboutFile for WorkspacePanel — reuses the same
  // prefillInput mechanism that ChatPanel already understands.
  // Nothing is sent automatically — the user edits and presses Send.
  function handleAskAboutProjectFile(
    projectName: string,
    filePath: string,
    content: string,
    size: number
  ): void {
    setAttachedProjectFile({ projectName, path: filePath, content, size });
    setPrefillInput("Explain this project file and suggest safe improvements.");
    handleActivity(
      `Project file queued for question: ${projectName}/${filePath}`,
      "info"
    );
  }

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

  // Called by ChatPanel when the user clicks "Open draft" after a successful write.
  // Passes the approved relative path to WorkspacePanel so it can navigate and preview.
  function handleOpenWorkspaceFile(relativePath: string): void {
    setOpenFileRequest(relativePath);
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
          {/* Dashboard and Chat both return to the main chat view */}
          <NavItem
            label="Dashboard"
            active={view === "chat"}
            onClick={() => setView("chat")}
          />
          <NavItem
            label="Chat"
            onClick={() => setView("chat")}
          />
          {/* Memory — now functional */}
          <NavItem
            label="Memory"
            active={view === "memory"}
            onClick={() => setView("memory")}
          />
          <NavItem label="Files" disabled />
          {/* Settings */}
          <NavItem
            label="Settings"
            active={view === "settings"}
            onClick={() => setView("settings")}
          />
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
          v0.9.2 — persistent memory context
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Center area — switches between Chat, Memory, and Settings */}
        {view === "chat" ? (
          /* Chat area — ChatPanel remounts when activeSessionId changes (key prop) */
          <section className="flex-1 flex flex-col border-r border-slate-800">
            {sessionReady && (
              <ChatPanel
                key={activeSessionId ?? "new"}
                onSessionUpdated={() => void fetchSessions()}
                attachment={attachment}
                onClearAttachment={handleClearAttachment}
                attachedProjectFile={attachedProjectFile}
                onClearAttachedProjectFile={handleClearAttachedProjectFile}
                prefillInput={prefillInput}
                onConsumePrefill={handleConsumePrefill}
                onActivity={handleActivity}
                onOpenWorkspaceFile={handleOpenWorkspaceFile}
                modelOverride={selectedModelOverride}
                defaultModel={defaultOllamaModel}
                memoryContext={selectedMemoryContext}
                onClearMemoryContext={handleMemoryContextClear}
              />
            )}
          </section>
        ) : view === "memory" ? (
          /* Memory area — manual notes and preferences, local SQLite only */
          <section className="flex-1 flex flex-col border-r border-slate-800 overflow-hidden">
            <MemoryPanel
              onActivity={handleActivity}
              selectedMemoryIds={new Set(selectedMemoryContext.map((m) => m.id))}
              onToggleMemoryContext={handleMemoryContextToggle}
              onClearMemoryContext={handleMemoryContextClear}
              onMemoryDeleted={handleMemoryDeleted}
            />
          </section>
        ) : (
          /* Settings area — read-only config and status view */
          <section className="flex-1 flex flex-col border-r border-slate-800 overflow-hidden">
            <SettingsPanel
              modelOverride={selectedModelOverride}
              onModelOverrideChange={handleModelOverrideChange}
              onModelOverrideClear={handleModelOverrideClear}
            />
          </section>
        )}

        {/* Right panel — tabbed layout */}
        <aside className="w-72 flex-shrink-0 flex flex-col overflow-hidden bg-[#0d1120]">
          {/* Tab bar — four equal-width tabs; active tab gets a cyan underline */}
          <div className="flex-shrink-0 flex">
            {(
              [
                { id: "status", label: "Status" },
                { id: "activity", label: "Activity" },
                { id: "workspace", label: "Workspace" },
                { id: "projects", label: "Projects" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setRightTab(id)}
                className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
                  rightTab === id
                    ? "text-cyan-400 border-cyan-500 bg-cyan-500/5"
                    : "text-slate-500 border-slate-800 hover:text-slate-300 hover:border-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content — each panel fills the remaining height */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === "status" && (
              /* Status tab: scrollable since model list can grow long */
              <div className="h-full overflow-y-auto">
                <StatusPanel />
              </div>
            )}
            {rightTab === "activity" && (
              /* Activity tab: ActivityPanel owns its own flex-1 scroll internally */
              <div className="h-full flex flex-col overflow-hidden">
                <ActivityPanel events={activities} />
              </div>
            )}
            {rightTab === "workspace" && (
              /* Workspace tab: WorkspacePanel fills the full height */
              <WorkspacePanel
                onAttachFile={handleAttachFile}
                onAskAboutFile={handleAskAboutFile}
                onActivity={handleActivity}
                openFileRequest={openFileRequest}
                onOpenFileRequestConsumed={() => setOpenFileRequest(null)}
              />
            )}
            {rightTab === "projects" && (
              /* Projects tab: ProjectLibraryPanel fills the full height */
              <ProjectLibraryPanel
                onActivity={handleActivity}
                onAttachFile={handleAttachProjectFile}
                onAskAboutFile={handleAskAboutProjectFile}
              />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

// Simple navigation item — no router dependency needed at this stage.
// onClick is optional so disabled items and items without a handler are safe.
function NavItem({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const base = "w-full text-left px-3 py-2 rounded text-sm transition-colors";
  const styles = disabled
    ? `${base} text-slate-600 cursor-not-allowed`
    : active
    ? `${base} bg-cyan-500/10 text-cyan-400 font-medium`
    : `${base} text-slate-400 hover:bg-slate-800 hover:text-slate-200`;

  return (
    <button className={styles} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

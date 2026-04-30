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
// localStorage key for the per-session memory context ID map.
// Shape: { "<sessionId>": ["uuid1", "uuid2", ...] }
// Only UUIDs are stored — full memory content always stays in SQLite only.
// Each chat session has its own independent memory selection.
const MEMORY_CONTEXT_BY_SESSION_KEY = "jarvis:memory-context-by-session";

// ── localStorage helpers for per-session memory context IDs ──────────────────
//
// Memory context is scoped per chat session.  Switching chats restores that
// chat's own selection; a new chat starts with an empty selection.
// Only UUIDs are persisted — never titles, content, or any memory body text.
// On restore, page.tsx fetches GET /memory and cross-references by ID so that
// stale IDs (deleted notes) are automatically cleaned up.

// Read the full session → IDs map from localStorage.
function readMemoryContextMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(MEMORY_CONTEXT_BY_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const result: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (Array.isArray(v)) {
        // Accept only string entries — guard against corrupted data
        result[k] = (v as unknown[]).filter(
          (x): x is string => typeof x === "string"
        );
      }
    }
    return result;
  } catch {
    return {};
  }
}

// Write the full map back to localStorage.
function writeMemoryContextMap(map: Record<string, string[]>): void {
  try {
    localStorage.setItem(
      MEMORY_CONTEXT_BY_SESSION_KEY,
      JSON.stringify(map)
    );
  } catch {
    // Storage quota exceeded or unavailable — not fatal
  }
}

// Return the saved memory IDs for one session (empty array if none).
function readMemoryContextIdsForSession(sessionId: number): string[] {
  return readMemoryContextMap()[String(sessionId)] ?? [];
}

// Persist the memory IDs for one session.
// Passing an empty array removes that session's entry from the map.
function writeMemoryContextIdsForSession(
  sessionId: number,
  ids: string[]
): void {
  const map = readMemoryContextMap();
  if (ids.length === 0) {
    delete map[String(sessionId)];
  } else {
    map[String(sessionId)] = ids;
  }
  writeMemoryContextMap(map);
}

// Clear the saved memory context for one session.
function clearMemoryContextForSession(sessionId: number): void {
  writeMemoryContextIdsForSession(sessionId, []);
}

// Remove a specific memory ID from every session's saved selection.
// Called when a memory note is deleted so no session retains a stale reference.
function removeMemoryIdFromAllSessions(memoryId: string): void {
  const map = readMemoryContextMap();
  let changed = false;
  for (const sessionId of Object.keys(map)) {
    const before = map[sessionId];
    const after = before.filter((id) => id !== memoryId);
    if (after.length !== before.length) {
      changed = true;
      if (after.length === 0) {
        delete map[sessionId];
      } else {
        map[sessionId] = after;
      }
    }
  }
  if (changed) writeMemoryContextMap(map);
}

// One-time migration: remove the old v0.9.2–v0.9.4 global key.
// That key stored a single flat array shared across all sessions, which caused
// memory context to bleed between chats.  v1.0.0+ uses the per-session map
// above.  We do NOT migrate the old IDs to any session because applying an
// unknown global selection to a specific chat would confuse the user.
function removeOldGlobalMemoryContextKey(): void {
  try {
    localStorage.removeItem("jarvis:selected-memory-context-ids");
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

  // Total number of memory notes in SQLite — used for the Memory nav badge.
  // null = not yet known (before first API response); 0+ = confirmed count.
  const [memoryCount, setMemoryCount] = useState<number | null>(null);

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

  // One-time startup migration: remove the old global memory context key.
  // v0.9.2–v0.9.4 stored a single flat array shared across all sessions which
  // caused memory context to bleed between chats.  v1.0.0+ uses a per-session
  // map — the old key is never read and should be removed on first load.
  useEffect(() => {
    removeOldGlobalMemoryContextKey();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore the saved memory context for the active session and refresh the
  // memory nav badge count whenever the active session changes.
  //
  // This effect runs:
  //   • On initial page load — when activeSessionId first becomes non-null
  //     (either read from localStorage or after a new session is created).
  //   • On every session switch — so each chat restores its own selection.
  //   • On new chat creation — new session has no saved IDs → empty selection.
  //
  // The session switch handlers (handleSwitchSession, handleNewChat,
  // handleDeleteSession) clear selectedMemoryContext synchronously before
  // setting the new activeSessionId, so the UI shows an empty state
  // immediately while this async fetch runs in the background.
  //
  // Stale IDs (notes deleted while a session was inactive) are silently
  // cleaned up — the cleaned list is written back to localStorage.
  // No Activity Log event is emitted for silent restores.
  useEffect(() => {
    // Not ready yet — wait for the session effect to resolve the session id
    if (activeSessionId === null) return;

    const savedIds = readMemoryContextIdsForSession(activeSessionId);
    // Capture session id so the async callback still refers to the right session
    // even if the user switches again before the fetch resolves.
    const currentSessionId = activeSessionId;

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

          // Always update the count for the nav badge
          setMemoryCount(d.memories.length);

          // Nothing to restore if no IDs are saved for this session
          if (savedIds.length === 0) return;

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

          setSelectedMemoryContext(restored);

          // Write back the cleaned list if any IDs were stale
          if (restored.length !== savedIds.length) {
            writeMemoryContextIdsForSession(
              currentSessionId,
              restored.map((m) => m.id)
            );
          }
        }
      )
      .catch(() => {
        // API unreachable — count stays as-is, selection stays cleared.
        // Saved IDs remain in localStorage for the next load attempt.
      });
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Toggle a memory note in/out of the current chat's context selection.
  // Persists the updated ID list under the active session id — content is never stored.
  // Activity events log the title only — content is never logged.
  function handleMemoryContextToggle(item: MemoryContextItem): void {
    // Safety guard — should never be null while the user is interacting
    if (activeSessionId === null) return;
    // Capture session id before the async state update so the localStorage
    // write targets the correct session even if the component re-renders.
    const sessionId = activeSessionId;
    setSelectedMemoryContext((prev) => {
      const exists = prev.some((m) => m.id === item.id);
      if (exists) {
        handleActivity(`Memory removed from context: ${item.title}`, "info");
        const next = prev.filter((m) => m.id !== item.id);
        // Persist updated IDs for this session only
        writeMemoryContextIdsForSession(sessionId, next.map((m) => m.id));
        return next;
      } else {
        handleActivity(`Memory included in context: ${item.title}`, "info");
        const next = [...prev, item];
        writeMemoryContextIdsForSession(sessionId, next.map((m) => m.id));
        return next;
      }
    });
  }

  // Clear all selected memory notes from the current chat's context.
  // Removes this session's entry from the per-session localStorage map.
  function handleMemoryContextClear(): void {
    if (activeSessionId !== null) {
      clearMemoryContextForSession(activeSessionId);
    }
    setSelectedMemoryContext([]);
    handleActivity("Memory context cleared", "info");
  }

  // Called by MemoryPanel after its internal memory list changes (load/add/delete).
  // Updates the nav badge count without any Activity Log noise.
  function handleMemoryCountChange(count: number): void {
    setMemoryCount(count);
  }

  // Called by MemoryPanel after a memory note is successfully deleted.
  // Removes the deleted ID from every session's saved selection in localStorage
  // so no chat can retain a stale reference to a note that no longer exists.
  // Also removes it from the current in-memory selection if it was active.
  // No Activity Log event here (MemoryPanel already logs the delete).
  function handleMemoryDeleted(id: string): void {
    // Clean the deleted ID from all session entries in the localStorage map
    removeMemoryIdFromAllSessions(id);
    // Remove from current in-memory selection if it was selected in this chat
    setSelectedMemoryContext((prev) => prev.filter((m) => m.id !== id));
  }

  // Called by MemoryPanel after a memory note is successfully updated (PATCH /memory/:id).
  // If the updated note is currently selected in this chat's context, replace it so the
  // chip and next outgoing message use the new title/content/type immediately.
  // localStorage continues to store only IDs — no update needed there.
  // No Activity Log event here (MemoryPanel already logs the update).
  function handleMemoryUpdated(updated: MemoryContextItem): void {
    setSelectedMemoryContext((prev) =>
      prev.map((m) => (m.id === updated.id ? updated : m))
    );
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

  // Switch to an existing session.
  // Memory context is cleared immediately so the old chat's selection does not
  // briefly appear for the new chat.  The activeSessionId effect then restores
  // the new session's own selection after fetching GET /memory.
  function handleSwitchSession(id: number): void {
    writeStoredSessionId(id);
    setSelectedMemoryContext([]); // clear immediately — effect restores new session's context
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

    // Clean up the deleted session's memory context from localStorage.
    // Do this for any deleted session (not just the active one) so the map
    // does not accumulate entries for sessions that no longer exist.
    clearMemoryContextForSession(id);

    // If the deleted session was active, create a fresh replacement session
    if (id === activeSessionId) {
      try {
        localStorage.removeItem(CHAT_CACHE_KEY);
      } catch {}
      // Clear memory context immediately — the new session starts fresh
      setSelectedMemoryContext([]);
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

  // Create a new blank session and switch to it.
  // Memory context is cleared immediately — new chats always start with no
  // selection.  The activeSessionId effect confirms this (new session has no
  // saved IDs in the per-session map).
  async function handleNewChat(): Promise<void> {
    const id = await createNewSession();
    if (id === null) return;
    // Clear the localStorage chat cache so the new session starts with the greeting
    try {
      localStorage.removeItem(CHAT_CACHE_KEY);
    } catch {}
    setSelectedMemoryContext([]); // new chat — no memory context
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
          {/* Memory — badge shows total count and active-context count */}
          <NavItem
            label="Memory"
            active={view === "memory"}
            onClick={() => setView("memory")}
            badge={
              memoryCount === null
                ? undefined // not yet loaded — no badge
                : selectedMemoryContext.length > 0
                ? `${memoryCount} · ${selectedMemoryContext.length}✓`
                : `${memoryCount}`
            }
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
          v1.2.0 — multi-file proposals
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
              onMemoryUpdated={handleMemoryUpdated}
              onMemoryCountChange={handleMemoryCountChange}
            />
          </section>
        ) : (
          /* Settings area — read-only config and status view */
          <section className="flex-1 flex flex-col border-r border-slate-800 overflow-hidden">
            <SettingsPanel
              modelOverride={selectedModelOverride}
              onModelOverrideChange={handleModelOverrideChange}
              onModelOverrideClear={handleModelOverrideClear}
              memoryCount={memoryCount}
              selectedMemoryCount={selectedMemoryContext.length}
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
// badge is an optional short string shown right-aligned (e.g. memory count).
function NavItem({
  label,
  badge,
  active,
  disabled,
  onClick,
}: {
  label: string;
  badge?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const base =
    "w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between gap-1";
  const styles = disabled
    ? `${base} text-slate-600 cursor-not-allowed`
    : active
    ? `${base} bg-cyan-500/10 text-cyan-400 font-medium`
    : `${base} text-slate-400 hover:bg-slate-800 hover:text-slate-200`;

  return (
    <button className={styles} disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      {badge !== undefined && (
        <span className="text-xs font-normal text-slate-600 flex-shrink-0">
          {badge}
        </span>
      )}
    </button>
  );
}

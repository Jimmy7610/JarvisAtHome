"use client";

import { useEffect, useState } from "react";
import type { MemoryContextItem } from "@/app/page";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// ── Types ─────────────────────────────────────────────────────────────────────

type MemoryType = "preference" | "project" | "note";

interface MemoryItem {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Per-type badge styles and labels
const TYPE_META: Record<MemoryType, { label: string; className: string }> = {
  preference: {
    label: "Preference",
    className:
      "bg-purple-500/10 text-purple-400 border border-purple-500/20",
  },
  project: {
    label: "Project",
    className: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
  },
  note: {
    label: "Note",
    className: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso + "Z").toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: MemoryType }) {
  const meta = TYPE_META[type];
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface MemoryPanelProps {
  // Reports activity events to the parent (page.tsx) for the Activity Log.
  // Title is logged; full content is never logged.
  onActivity?: (text: string, type?: "info" | "write" | "error") => void;

  // Set of memory IDs currently selected as chat context.
  // Managed by page.tsx; passed down so toggles reflect the current state.
  selectedMemoryIds?: Set<string>;

  // Toggle a memory note in/out of the chat context selection.
  // Called with the full MemoryContextItem so page.tsx can store content.
  onToggleMemoryContext?: (item: MemoryContextItem) => void;

  // Clear all selected memory notes from chat context.
  onClearMemoryContext?: () => void;

  // Called after a memory note is successfully deleted from the backend.
  // Allows page.tsx to immediately remove the deleted note from the chat context
  // selection and localStorage — no stale IDs after delete.
  onMemoryDeleted?: (id: string) => void;

  // Called after a memory note is successfully updated (PATCH /memory/:id).
  // Allows page.tsx to immediately refresh the note in selectedMemoryContext if
  // it is currently included in this chat — content/title update takes effect
  // for the next outgoing message without any further user action.
  // localStorage is unchanged — IDs are stable across edits.
  onMemoryUpdated?: (item: MemoryContextItem) => void;

  // Called whenever the local memory list changes (after load, add, or delete).
  // Used by page.tsx to keep the Memory nav badge count up to date.
  // No Activity Log event is emitted for count changes — it is display-only.
  onMemoryCountChange?: (count: number) => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MemoryPanel({
  onActivity,
  selectedMemoryIds = new Set(),
  onToggleMemoryContext,
  onClearMemoryContext,
  onMemoryDeleted,
  onMemoryUpdated,
  onMemoryCountChange,
}: MemoryPanelProps) {
  // ── Data state ──────────────────────────────────────────────────────────────
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Add-form state ──────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState<MemoryType>("note");
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // ── Edit state ───────────────────────────────────────────────────────────────
  // editingId: the id of the memory note currently open in inline edit mode.
  // Only one note can be edited at a time — opening a new edit closes any other.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState<MemoryType>("note");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ── Filter / search state ────────────────────────────────────────────────────
  // activeTypeFilter — which type bucket is shown.
  // "in-chat" shows only notes currently selected for this chat.
  // Resets to "all" on page reload (not persisted).
  type TypeFilter = "all" | "preference" | "project" | "note" | "in-chat";
  const [activeTypeFilter, setActiveTypeFilter] = useState<TypeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Load memories ───────────────────────────────────────────────────────────
  function loadMemories(): void {
    setLoading(true);
    setLoadError(false);
    fetch(`${API_URL}/memory`)
      .then((r) => r.json())
      .then((d: { ok: boolean; memories?: MemoryItem[] }) => {
        if (d.ok && Array.isArray(d.memories)) {
          setMemories(d.memories);
        } else {
          setLoadError(true);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadMemories();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent of the current memory count after each load/add/delete.
  // Fires only when loading is complete to avoid reporting the initial empty-array
  // state before the fetch resolves (which would briefly show 0 and then jump to
  // the real count, racing with the page.tsx mount fetch that already set it).
  useEffect(() => {
    if (!loading) {
      onMemoryCountChange?.(memories.length);
    }
  }, [memories, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add memory ──────────────────────────────────────────────────────────────
  async function handleAdd(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const title = formTitle.trim();
    const content = formContent.trim();
    if (!title || !content) {
      setAddError("Title and content are required.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`${API_URL}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: formType, title, content }),
      });
      const data = (await res.json()) as { ok: boolean; memory?: MemoryItem; error?: string };
      if (!data.ok || !data.memory) {
        setAddError(data.error ?? "Failed to save memory.");
        return;
      }
      // Prepend new memory to the top of the list (newest first)
      setMemories((prev) => [data.memory!, ...prev]);
      // Log activity — title only, never content
      onActivity?.(`Memory added: ${title}`, "info");
      // Reset form
      setFormTitle("");
      setFormContent("");
      setFormType("note");
      setFormOpen(false);
    } catch {
      setAddError("Could not reach the Jarvis API.");
    } finally {
      setAdding(false);
    }
  }

  // ── Delete memory ───────────────────────────────────────────────────────────
  async function handleDelete(item: MemoryItem): Promise<void> {
    if (!window.confirm(`Delete memory "${item.title}"?`)) return;
    try {
      const res = await fetch(`${API_URL}/memory/${item.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        alert(data.error ?? "Failed to delete memory.");
        return;
      }
      setMemories((prev) => prev.filter((m) => m.id !== item.id));
      onActivity?.(`Memory deleted: ${item.title}`, "info");
      // Notify parent so it can remove the deleted note from selected context
      // and localStorage immediately — no stale IDs left after delete.
      onMemoryDeleted?.(item.id);
    } catch {
      alert("Could not reach the Jarvis API.");
    }
  }

  // ── Edit memory ─────────────────────────────────────────────────────────────

  // Open the inline edit form for a specific memory note.
  // Closes any other open edit form first (only one at a time).
  function handleEditOpen(item: MemoryItem): void {
    setEditingId(item.id);
    setEditType(item.type);
    setEditTitle(item.title);
    setEditContent(item.content);
    setEditError(null);
  }

  // Close the edit form without saving.
  function handleEditCancel(): void {
    setEditingId(null);
    setEditError(null);
  }

  // Submit the edit form — PATCH /memory/:id.
  // Only the user can call this — there is no AI path to this function.
  // Title is logged; content is never logged.
  async function handleEditSave(id: string): Promise<void> {
    const title = editTitle.trim();
    const content = editContent.trim();
    if (!title) {
      setEditError("Title is required.");
      return;
    }
    if (!content) {
      setEditError("Content is required.");
      return;
    }

    setSaving(true);
    setEditError(null);

    try {
      const res = await fetch(`${API_URL}/memory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: editType, title, content }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        memory?: MemoryItem;
        error?: string;
      };

      if (!data.ok || !data.memory) {
        setEditError(data.error ?? "Failed to save changes.");
        return;
      }

      // Update the memory in the local list
      setMemories((prev) =>
        prev.map((m) => (m.id === id ? data.memory! : m))
      );

      // Notify page.tsx so it can update selectedMemoryContext if this note
      // is currently included in this chat — no localStorage change needed
      // because the ID is stable across edits.
      onMemoryUpdated?.({
        id: data.memory.id,
        type: data.memory.type,
        title: data.memory.title,
        content: data.memory.content,
      });

      // Log the update — title only, never content
      onActivity?.(`Memory updated: ${data.memory.title}`, "info");

      // Close the edit form
      setEditingId(null);
    } catch {
      setEditError("Could not reach the Jarvis API.");
    } finally {
      setSaving(false);
    }
  }

  // ── Filtered list ───────────────────────────────────────────────────────────
  // Step 1: apply type/in-chat filter
  const typeFilteredMemories =
    activeTypeFilter === "all"
      ? memories
      : activeTypeFilter === "in-chat"
      ? memories.filter((m) => selectedMemoryIds.has(m.id))
      : memories.filter((m) => m.type === activeTypeFilter);

  // Step 2: apply search query on top of the type-filtered list.
  // Searches title, content, and type — case-insensitive, trimmed.
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const displayMemories = trimmedQuery
    ? typeFilteredMemories.filter(
        (m) =>
          m.title.toLowerCase().includes(trimmedQuery) ||
          m.content.toLowerCase().includes(trimmedQuery) ||
          m.type.toLowerCase().includes(trimmedQuery)
      )
    : typeFilteredMemories;

  // Per-filter counts shown on filter buttons (always computed from the full list)
  const filterCounts: Record<TypeFilter, number> = {
    all: memories.length,
    preference: memories.filter((m) => m.type === "preference").length,
    project: memories.filter((m) => m.type === "project").length,
    note: memories.filter((m) => m.type === "note").length,
    "in-chat": memories.filter((m) => selectedMemoryIds.has(m.id)).length,
  };

  // Whether any filter/search is active (used to show "Clear filters" button)
  const isFiltered = activeTypeFilter !== "all" || trimmedQuery !== "";

  // Clear both type filter and search in one click
  function handleClearFilters(): void {
    setActiveTypeFilter("all");
    setSearchQuery("");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">

        {/* Page header */}
        <div className="border-b border-slate-800 pb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100 tracking-tight">
              Memory
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Manual notes and preferences · local SQLite ·{" "}
              <span className="text-slate-600">
                toggle notes to include in chat context
              </span>
            </p>
          </div>
          <button
            onClick={() => { setFormOpen((v) => !v); setAddError(null); }}
            className={`flex-shrink-0 text-xs px-3 py-1.5 rounded border transition-colors ${
              formOpen
                ? "border-cyan-500/50 text-cyan-400 bg-cyan-500/5"
                : "border-slate-700 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-400"
            }`}
          >
            {formOpen ? "Cancel" : "+ Add memory"}
          </button>
        </div>

        {/* Chat context selection summary — shown when one or more notes are selected */}
        {selectedMemoryIds.size > 0 && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs">
            <span className="text-purple-300">
              <span className="font-medium">{selectedMemoryIds.size}</span>{" "}
              note{selectedMemoryIds.size !== 1 ? "s" : ""} included in this chat ·{" "}
              <span className="text-purple-500">this chat only</span>
            </span>
            <button
              onClick={onClearMemoryContext}
              className="flex-shrink-0 text-purple-600 hover:text-purple-300 transition-colors"
              title="Remove all from this chat's context"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Add memory form */}
        {formOpen && (
          <div className="rounded-lg border border-slate-700/60 bg-slate-800/30 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
              New memory
            </h3>
            <form onSubmit={(e) => void handleAdd(e)} className="space-y-3">
              {/* Type selector */}
              <div className="flex gap-2">
                {(["note", "preference", "project"] as MemoryType[]).map(
                  (t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFormType(t)}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                        formType === t
                          ? TYPE_META[t].className
                          : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400"
                      }`}
                    >
                      {TYPE_META[t].label}
                    </button>
                  )
                )}
              </div>

              {/* Title input */}
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Title"
                maxLength={200}
                className="w-full rounded bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />

              {/* Content textarea */}
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="Content"
                maxLength={2000}
                rows={3}
                className="w-full rounded bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors resize-none"
              />

              {/* Error */}
              {addError && (
                <p className="text-xs text-red-400">{addError}</p>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={adding}
                className="text-xs px-4 py-1.5 rounded border border-cyan-500/40 text-cyan-400 bg-cyan-500/5 hover:bg-cyan-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? "Saving…" : "Save memory"}
              </button>
            </form>
          </div>
        )}

        {/* ── Type filter bar + search ─────────────────────────────────────── */}
        {!loading && !loadError && memories.length > 0 && (
          <div className="space-y-2">
            {/* Filter pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { key: "all",        label: "All" },
                  { key: "preference", label: "Preferences" },
                  { key: "project",    label: "Projects" },
                  { key: "note",       label: "Notes" },
                  { key: "in-chat",    label: "In this chat" },
                ] as { key: TypeFilter; label: string }[]
              ).map(({ key, label }) => {
                const isActive = activeTypeFilter === key;
                const count = filterCounts[key];
                // Per-filter active style
                const activeStyle =
                  key === "preference"
                    ? "border-purple-500/50 text-purple-400 bg-purple-500/10"
                    : key === "project"
                    ? "border-cyan-500/50 text-cyan-400 bg-cyan-500/10"
                    : key === "note"
                    ? "border-blue-500/50 text-blue-400 bg-blue-500/10"
                    : key === "in-chat"
                    ? "border-purple-500/50 text-purple-400 bg-purple-500/10"
                    : "border-slate-500 text-slate-200 bg-slate-700/50";
                return (
                  <button
                    key={key}
                    onClick={() => setActiveTypeFilter(key)}
                    className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
                      isActive
                        ? activeStyle
                        : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400"
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span
                        className={`ml-1 font-mono ${
                          isActive ? "opacity-80" : "opacity-50"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Search input row */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title, content, or type…"
                className="flex-1 rounded bg-slate-800/60 border border-slate-700 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
              {isFiltered && (
                <button
                  onClick={handleClearFilters}
                  className="flex-shrink-0 text-xs text-slate-500 hover:text-slate-300 transition-colors whitespace-nowrap"
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* Result summary */}
            {(isFiltered || memories.length > 0) && (
              <p className="text-xs text-slate-600">
                {isFiltered
                  ? displayMemories.length === 0
                    ? "No matching memories"
                    : `Showing ${displayMemories.length} of ${memories.length} ${memories.length === 1 ? "memory" : "memories"}`
                  : `${memories.length} ${memories.length === 1 ? "memory" : "memories"}`}
              </p>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <p className="text-sm text-slate-500 animate-pulse py-4 text-center">
            Loading memories…
          </p>
        )}

        {/* Load error */}
        {!loading && loadError && (
          <div className="rounded-lg border border-red-500/20 bg-red-900/10 p-4 text-center">
            <p className="text-sm text-red-400/80">
              Could not load memories — is the Jarvis API running?
            </p>
            <button
              onClick={loadMemories}
              className="mt-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !loadError && memories.length === 0 && (
          <div className="rounded-lg border border-slate-700/40 bg-slate-800/20 p-8 text-center">
            <p className="text-sm text-slate-500">No memories yet.</p>
            <p className="text-xs text-slate-600 mt-1">
              Click &quot;+ Add memory&quot; above to create your first memory note.
            </p>
          </div>
        )}

        {/* Context-aware empty state when filters/search produce no results */}
        {!loading && !loadError && memories.length > 0 && displayMemories.length === 0 && (
          <div className="rounded-lg border border-slate-700/40 bg-slate-800/20 p-6 text-center">
            <p className="text-sm text-slate-500">
              {activeTypeFilter === "in-chat"
                ? trimmedQuery
                  ? `No selected memories match "${searchQuery}".`
                  : "No memories are selected for this chat."
                : activeTypeFilter !== "all"
                ? trimmedQuery
                  ? `No ${activeTypeFilter} memories match "${searchQuery}".`
                  : `No ${activeTypeFilter} memories yet.`
                : `No memories match "${searchQuery}".`}
            </p>
            <button
              onClick={handleClearFilters}
              className="mt-2 text-xs text-cyan-500 hover:text-cyan-400 transition-colors"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Memory list */}
        {!loading && !loadError && displayMemories.length > 0 && (
          <div className="space-y-3">
            {displayMemories.map((item) => {
              const isEditing = editingId === item.id;
              return (
                <div
                  key={item.id}
                  className={`rounded-lg border bg-slate-800/30 p-4 transition-colors ${
                    isEditing
                      ? "border-cyan-500/30 bg-slate-800/50"
                      : "border-slate-700/60"
                  }`}
                >
                  {isEditing ? (
                    /* ── Inline edit form ─────────────────────────────────── */
                    <div className="space-y-3">
                      {/* Edit header */}
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                        Edit memory
                      </p>

                      {/* Type selector */}
                      <div className="flex gap-2">
                        {(["note", "preference", "project"] as MemoryType[]).map(
                          (t) => (
                            <button
                              key={t}
                              type="button"
                              disabled={saving}
                              onClick={() => setEditType(t)}
                              className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                                editType === t
                                  ? TYPE_META[t].className
                                  : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400"
                              }`}
                            >
                              {TYPE_META[t].label}
                            </button>
                          )
                        )}
                      </div>

                      {/* Title input */}
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Title"
                        maxLength={200}
                        disabled={saving}
                        className="w-full rounded bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
                      />

                      {/* Content textarea */}
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        placeholder="Content"
                        maxLength={2000}
                        rows={3}
                        disabled={saving}
                        className="w-full rounded bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors resize-none disabled:opacity-50"
                      />

                      {/* Error message */}
                      {editError && (
                        <p className="text-xs text-red-400">{editError}</p>
                      )}

                      {/* Save / Cancel */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleEditSave(item.id)}
                          className="text-xs px-4 py-1.5 rounded border border-cyan-500/40 text-cyan-400 bg-cyan-500/5 hover:bg-cyan-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleEditCancel}
                          className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300 transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal read view ─────────────────────────────────── */
                    <>
                      {/* Top row: type badge + title + action buttons */}
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <TypeBadge type={item.type} />
                          <span className="text-sm font-medium text-slate-200 truncate">
                            {item.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Include in this chat's context toggle */}
                          <button
                            onClick={() =>
                              onToggleMemoryContext?.({
                                id: item.id,
                                type: item.type,
                                title: item.title,
                                content: item.content,
                              })
                            }
                            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                              selectedMemoryIds.has(item.id)
                                ? "border-purple-500/50 text-purple-400 bg-purple-500/10"
                                : "border-slate-700 text-slate-600 hover:border-purple-500/30 hover:text-purple-400"
                            }`}
                            title={
                              selectedMemoryIds.has(item.id)
                                ? "Remove from this chat"
                                : "Include in this chat"
                            }
                          >
                            {selectedMemoryIds.has(item.id)
                              ? "✓ In this chat"
                              : "In this chat"}
                          </button>
                          {/* Edit button — opens inline edit form */}
                          <button
                            onClick={() => handleEditOpen(item)}
                            className="text-xs text-slate-600 hover:text-cyan-400 transition-colors"
                            title="Edit memory"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void handleDelete(item)}
                            className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                            title="Delete memory"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Content */}
                      <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-wrap break-words">
                        {item.content}
                      </p>

                      {/* Timestamps — show updated_at when it differs from created_at */}
                      <p className="text-xs text-slate-700 mt-2">
                        {item.updated_at !== item.created_at
                          ? `Updated ${formatDate(item.updated_at)}`
                          : formatDate(item.created_at)}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        <p className="text-xs text-slate-700 text-center pb-2">
          Memory is manual-only · stored in local SQLite ·
          not sent to Ollama or any cloud service
        </p>
      </div>
    </div>
  );
}

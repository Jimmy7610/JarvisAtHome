"use client";

import { useEffect, useState } from "react";

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
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MemoryPanel({ onActivity }: MemoryPanelProps) {
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

  // ── Filter state ────────────────────────────────────────────────────────────
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
    } catch {
      alert("Could not reach the Jarvis API.");
    }
  }

  // ── Filtered list ───────────────────────────────────────────────────────────
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const displayMemories =
    trimmedQuery
      ? memories.filter(
          (m) =>
            m.title.toLowerCase().includes(trimmedQuery) ||
            m.content.toLowerCase().includes(trimmedQuery) ||
            m.type.toLowerCase().includes(trimmedQuery)
        )
      : memories;

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
                no automatic memory injection in v0.9.0
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

        {/* Search / filter */}
        {!loading && !loadError && memories.length > 0 && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memories…"
              className="flex-1 rounded bg-slate-800/60 border border-slate-700 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear
              </button>
            )}
            {searchQuery && (
              <span className="text-xs text-slate-600 flex-shrink-0">
                {displayMemories.length} match
                {displayMemories.length !== 1 ? "es" : ""}
              </span>
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

        {/* No search results */}
        {!loading && !loadError && memories.length > 0 && searchQuery && displayMemories.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">
            No memories match &ldquo;{searchQuery}&rdquo;.{" "}
            <button
              onClick={() => setSearchQuery("")}
              className="text-cyan-500 hover:text-cyan-400 transition-colors"
            >
              Clear search
            </button>
          </p>
        )}

        {/* Memory list */}
        {!loading && !loadError && displayMemories.length > 0 && (
          <div className="space-y-3">
            {displayMemories.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-slate-700/60 bg-slate-800/30 p-4"
              >
                {/* Top row: type badge + title + delete */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <TypeBadge type={item.type} />
                    <span className="text-sm font-medium text-slate-200 truncate">
                      {item.title}
                    </span>
                  </div>
                  <button
                    onClick={() => void handleDelete(item)}
                    className="flex-shrink-0 text-xs text-slate-600 hover:text-red-400 transition-colors"
                    title="Delete memory"
                  >
                    Delete
                  </button>
                </div>

                {/* Content */}
                <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-wrap break-words">
                  {item.content}
                </p>

                {/* Timestamp */}
                <p className="text-xs text-slate-700 mt-2">
                  {formatDate(item.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Footer note */}
        <p className="text-xs text-slate-700 text-center pb-2">
          Memory is manual-only in v0.9.0 · stored in local SQLite ·
          not sent to Ollama or any cloud service
        </p>
      </div>
    </div>
  );
}

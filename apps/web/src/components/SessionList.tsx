"use client";

// Session list displayed in the left sidebar.
// Shows the "New Chat" button and a scrollable list of past sessions.
// Each session row has a rename (pencil) button and a delete (×) button, visible on hover.
// Clicking rename enters inline edit mode for that row — Enter saves, Escape or blur cancels.

import { useState } from "react";

export type SessionRow = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

interface SessionListProps {
  sessions: SessionRow[];
  activeSessionId: number | null;
  loading: boolean;
  onNewChat: () => void;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, newTitle: string) => void;
}

// Format updated_at date (SQLite UTC string) as a short human label.
function formatDate(utcStr: string): string {
  // SQLite stores dates without timezone info — treat as UTC
  const date = new Date(utcStr.replace(" ", "T") + "Z");
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  // Fallback: YYYY-MM-DD
  return utcStr.slice(0, 10);
}

// Pencil icon — inline SVG so there is no font/emoji dependency.
function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="w-3 h-3"
      aria-hidden="true"
    >
      <path d="M11.013 2.513a1.75 1.75 0 0 1 2.475 2.474L6.226 12.25a2.751 2.751 0 0 1-.892.596l-2.047.848a.75.75 0 0 1-.98-.98l.848-2.047a2.75 2.75 0 0 1 .596-.892l7.262-7.261Z" />
    </svg>
  );
}

export default function SessionList({
  sessions,
  activeSessionId,
  loading,
  onNewChat,
  onSelect,
  onDelete,
  onRename,
}: SessionListProps) {
  // Which session id is currently being renamed (null = none)
  const [editingId, setEditingId] = useState<number | null>(null);
  // Draft title value while editing
  const [editValue, setEditValue] = useState("");

  function startEdit(session: SessionRow, e: React.MouseEvent): void {
    e.stopPropagation();
    setEditingId(session.id);
    setEditValue(session.title);
  }

  function commitEdit(id: number): void {
    const trimmed = editValue.trim().slice(0, 80);
    if (!trimmed) {
      // Empty title — cancel instead of saving
      setEditingId(null);
      return;
    }
    setEditingId(null);
    onRename(id, trimmed);
  }

  function cancelEdit(): void {
    setEditingId(null);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* New Chat button */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={onNewChat}
          className="w-full text-left px-3 py-2 rounded text-xs font-medium
                     bg-cyan-500/10 text-cyan-400 border border-cyan-500/20
                     hover:bg-cyan-500/20 transition-colors"
        >
          + New Chat
        </button>
        {/* Keyboard shortcut hint */}
        <p className="text-center text-xs text-slate-700 mt-1 tracking-wide">
          Ctrl+Alt+N
        </p>
      </div>

      {/* Section label */}
      <p className="px-5 pb-1 text-xs text-slate-700 uppercase tracking-wider font-medium">
        Chats
      </p>

      {/* Scrollable session list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-px">
        {loading && (
          <p className="px-2 py-2 text-xs text-slate-600">Loading…</p>
        )}

        {!loading && sessions.length === 0 && (
          <p className="px-2 py-2 text-xs text-slate-600">No chats yet.</p>
        )}

        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const isEditing = session.id === editingId;

          // Inline edit mode: full-width input replaces the row
          if (isEditing) {
            return (
              <div key={session.id} className="px-2 py-1">
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit(session.id);
                    if (e.key === "Escape") cancelEdit();
                  }}
                  // Blur cancels — prevents accidentally saving a half-edited title
                  onBlur={cancelEdit}
                  maxLength={80}
                  className="w-full bg-slate-800 text-slate-200 text-xs px-2 py-1.5 rounded
                             border border-slate-600 focus:outline-none focus:border-cyan-500/50"
                  aria-label="Rename chat"
                />
              </div>
            );
          }

          // Normal mode: select button + hover action buttons
          return (
            // Outer container: hover group so action buttons fade in on row hover
            <div
              key={session.id}
              className={`group flex items-center rounded transition-colors
                ${isActive ? "bg-slate-700/60" : "hover:bg-slate-800/60"}`}
            >
              {/* Select button — fills the row */}
              <button
                onClick={() => onSelect(session.id)}
                className={`flex-1 min-w-0 text-left px-3 py-2
                  ${isActive ? "text-slate-200" : "text-slate-500 hover:text-slate-300"}`}
              >
                <div className="text-xs font-medium truncate pr-1">{session.title}</div>
                <div className="text-xs text-slate-700 mt-0.5">
                  {formatDate(session.updated_at)}
                </div>
              </button>

              {/* Rename button — pencil icon, visible on row hover */}
              <button
                onClick={(e) => startEdit(session, e)}
                className="flex-shrink-0 px-1 text-slate-600
                           hover:text-cyan-400 opacity-0 group-hover:opacity-100
                           focus:opacity-100 transition-opacity"
                aria-label={`Rename "${session.title}"`}
                title="Rename chat"
              >
                <PencilIcon />
              </button>

              {/* Delete button — subtle ×, visible on row hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const confirmed = window.confirm(
                    `Delete chat "${session.title}"? This cannot be undone.`
                  );
                  if (confirmed) onDelete(session.id);
                }}
                className="flex-shrink-0 mr-2 px-1 text-slate-600
                           hover:text-red-400 opacity-0 group-hover:opacity-100
                           focus:opacity-100 transition-opacity text-sm leading-none"
                aria-label={`Delete "${session.title}"`}
                title="Delete chat"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

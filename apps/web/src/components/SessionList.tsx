"use client";

// Session list displayed in the left sidebar.
// Shows the "New Chat" button and a scrollable list of past sessions.

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

export default function SessionList({
  sessions,
  activeSessionId,
  loading,
  onNewChat,
  onSelect,
  onDelete,
}: SessionListProps) {
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
          return (
            // Outer container: hover group so delete button fades in on row hover
            <div
              key={session.id}
              className={`group flex items-center rounded transition-colors
                ${
                  isActive
                    ? "bg-slate-700/60"
                    : "hover:bg-slate-800/60"
                }`}
            >
              {/* Select button — fills the row, leaves space for delete button */}
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

              {/* Delete button — subtle ×, only visible on row hover */}
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

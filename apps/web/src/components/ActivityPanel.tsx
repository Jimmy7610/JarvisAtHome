// ActivityPanel — live system activity log.
// Events are owned by page.tsx and passed as props.
// Event types: "info" (default), "write" (write proposals/approvals), "error".

export type ActivityEvent = {
  id: string;
  time: string;
  text: string;
  type: "info" | "write" | "error";
};

// Visual style per event type
const EVENT_STYLES: Record<
  ActivityEvent["type"],
  { card: string; text: string; badge?: string }
> = {
  info: {
    card: "bg-slate-800/50 border border-slate-700/50",
    text: "text-slate-300",
  },
  write: {
    card: "bg-amber-900/10 border border-amber-500/20",
    text: "text-amber-300",
    badge: "write",
  },
  error: {
    card: "bg-red-900/10 border border-red-500/20",
    text: "text-red-400",
    badge: "error",
  },
};

export default function ActivityPanel({
  events,
}: {
  events: ActivityEvent[];
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
        Activity Log
      </h2>

      <div className="flex-1 overflow-y-auto space-y-2">
        {events.length === 0 && (
          <p className="text-xs text-slate-700 text-center">No events yet.</p>
        )}
        {events.map((e) => {
          const styles = EVENT_STYLES[e.type];
          return (
            <div
              key={e.id}
              className={`rounded px-3 py-2.5 ${styles.card}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`text-xs leading-relaxed break-words overflow-wrap-anywhere flex-1 min-w-0 ${styles.text}`}
                >
                  {e.text}
                </p>
                {styles.badge && (
                  <span
                    className={`flex-shrink-0 ml-1 text-xs px-1.5 py-px rounded font-medium ${
                      e.type === "write"
                        ? "bg-amber-500/60 text-slate-900"
                        : "bg-red-500/60 text-slate-100"
                    }`}
                  >
                    {styles.badge}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-1">{e.time}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

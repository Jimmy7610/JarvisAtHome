// ActivityPanel — right-side system activity log (mock data for v0.1)
export default function ActivityPanel() {
  const events = [
    { time: "now", text: "Dashboard loaded" },
    { time: "now", text: "API health check triggered" },
    { time: "now", text: "Ollama status check active" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
        Activity Log
      </h2>

      <div className="flex-1 overflow-y-auto space-y-2">
        {events.map((e, i) => (
          <div
            key={i}
            className="rounded bg-slate-800/50 border border-slate-700/50 px-3 py-2"
          >
            <p className="text-xs text-slate-300">{e.text}</p>
            <p className="text-xs text-slate-600 mt-0.5">{e.time}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-700 mt-3 text-center">
        Live activity in v0.2
      </p>
    </div>
  );
}

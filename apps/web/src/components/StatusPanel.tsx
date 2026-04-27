"use client";

import { useEffect, useState } from "react";

type ApiStatus = "checking" | "online" | "offline";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function StatusPanel() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [apiVersion, setApiVersion] = useState<string | null>(null);

  // Check the API health endpoint once on mount
  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setApiStatus("online");
          setApiVersion(data.version ?? null);
        } else {
          setApiStatus("offline");
        }
      })
      .catch(() => setApiStatus("offline"));
  }, []);

  const recheck = () => {
    setApiStatus("checking");
    setApiVersion(null);
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((data) => {
        setApiStatus(data.ok ? "online" : "offline");
        setApiVersion(data.version ?? null);
      })
      .catch(() => setApiStatus("offline"));
  };

  return (
    <div className="border-b border-slate-800 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
        System Status
      </h2>

      <div className="space-y-2">
        <StatusRow label="Frontend" status="online" detail="Next.js" />
        <StatusRow
          label="API"
          status={apiStatus}
          detail={apiVersion ? `v${apiVersion}` : undefined}
        />
        <StatusRow label="Ollama" status="planned" detail="not connected" />
      </div>

      <button
        onClick={recheck}
        className="mt-3 w-full text-xs py-1.5 rounded border border-slate-700 text-slate-400 hover:border-cyan-500/50 hover:text-cyan-400 transition-colors"
      >
        Re-check status
      </button>
    </div>
  );
}

function StatusRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: ApiStatus | "planned";
  detail?: string;
}) {
  const dot: Record<typeof status, string> = {
    online: "bg-emerald-400",
    offline: "bg-red-500",
    checking: "bg-amber-400 animate-pulse",
    planned: "bg-slate-600",
  };

  const text: Record<typeof status, string> = {
    online: "text-emerald-400",
    offline: "text-red-400",
    checking: "text-amber-400",
    planned: "text-slate-500",
  };

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-slate-300">
        <span className={`w-2 h-2 rounded-full ${dot[status]}`} />
        {label}
      </span>
      <span className={`text-xs ${text[status]}`}>
        {detail ?? status}
      </span>
    </div>
  );
}

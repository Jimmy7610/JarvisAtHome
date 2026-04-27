"use client";

import { useEffect, useState, useCallback } from "react";

type SimpleStatus = "checking" | "online" | "offline";

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

interface OllamaData {
  ok: boolean;
  baseUrl: string;
  configuredDefaultModel: string;
  resolvedDefaultModel: string | null;
  models: OllamaModel[];
  error?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Format byte count as a readable size string
function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${bytes} B`;
}

export default function StatusPanel() {
  const [apiStatus, setApiStatus] = useState<SimpleStatus>("checking");
  const [apiVersion, setApiVersion] = useState<string | null>(null);
  const [ollamaData, setOllamaData] = useState<OllamaData | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<SimpleStatus>("checking");

  const fetchAll = useCallback(() => {
    setApiStatus("checking");
    setApiVersion(null);
    setOllamaStatus("checking");
    setOllamaData(null);

    // Check API health
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((data) => {
        setApiStatus(data.ok ? "online" : "offline");
        setApiVersion(data.version ?? null);
      })
      .catch(() => setApiStatus("offline"));

    // Check Ollama status via API proxy
    fetch(`${API_URL}/ollama/status`)
      .then((r) => r.json())
      .then((data: OllamaData) => {
        setOllamaData(data);
        setOllamaStatus(data.ok ? "online" : "offline");
      })
      .catch(() => {
        setOllamaStatus("offline");
        setOllamaData(null);
      });
  }, []);

  // Run checks on mount
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const ollamaDetail = ollamaData?.ok
    ? `${ollamaData.models.length} model${ollamaData.models.length !== 1 ? "s" : ""}`
    : ollamaStatus === "checking"
    ? undefined
    : "offline";

  // True when the configured model is missing but a fallback is being used
  const usingFallback =
    ollamaData?.ok &&
    ollamaData.resolvedDefaultModel !== null &&
    ollamaData.resolvedDefaultModel !== ollamaData.configuredDefaultModel;

  return (
    <div className="border-b border-slate-800 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
        System Status
      </h2>

      {/* Top-level status rows */}
      <div className="space-y-2">
        <StatusRow label="Frontend" status="online" detail="Next.js" />
        <StatusRow
          label="API"
          status={apiStatus}
          detail={apiVersion ? `v${apiVersion}` : undefined}
        />
        <StatusRow
          label="Ollama"
          status={ollamaStatus}
          detail={ollamaDetail}
        />
      </div>

      {/* Ollama detail block — only shown when Ollama is reachable */}
      {ollamaData?.ok && (
        <div className="mt-3 rounded border border-slate-700/60 bg-slate-800/40 p-3 space-y-2">

          {/* Active model row */}
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Active model</p>
            <p className="text-xs font-mono text-cyan-400 truncate">
              {ollamaData.resolvedDefaultModel ?? "—"}
            </p>
          </div>

          {/* Fallback notice */}
          {usingFallback && (
            <div className="rounded bg-amber-900/20 border border-amber-700/40 px-2 py-1.5">
              <p className="text-xs text-amber-300/80 leading-relaxed">
                Configured model{" "}
                <span className="font-mono">{ollamaData.configuredDefaultModel}</span>{" "}
                is not installed. Using{" "}
                <span className="font-mono">{ollamaData.resolvedDefaultModel}</span>{" "}
                instead.
              </p>
            </div>
          )}

          {/* Model list */}
          {ollamaData.models.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1">
                Available ({ollamaData.models.length})
              </p>
              <ul className="space-y-1">
                {ollamaData.models.map((m) => (
                  <li
                    key={m.name}
                    className="flex items-center justify-between gap-2"
                  >
                    <span
                      className={`text-xs font-mono truncate ${
                        m.name === ollamaData.resolvedDefaultModel
                          ? "text-cyan-400"
                          : "text-slate-300"
                      }`}
                    >
                      {m.name}
                      {m.name === ollamaData.resolvedDefaultModel && (
                        <span className="ml-1 text-slate-600">✓</span>
                      )}
                    </span>
                    <span className="text-xs text-slate-600 flex-shrink-0">
                      {formatBytes(m.size)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Error message when Ollama is offline */}
      {ollamaData && !ollamaData.ok && ollamaData.error && (
        <p className="mt-2 text-xs text-red-400/70 leading-relaxed">
          {ollamaData.error}
        </p>
      )}

      <button
        onClick={fetchAll}
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
  status: SimpleStatus;
  detail?: string;
}) {
  const dot: Record<SimpleStatus, string> = {
    online: "bg-emerald-400",
    offline: "bg-red-500",
    checking: "bg-amber-400 animate-pulse",
  };

  const text: Record<SimpleStatus, string> = {
    online: "text-emerald-400",
    offline: "text-red-400",
    checking: "text-amber-400",
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

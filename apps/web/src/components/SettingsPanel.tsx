"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SettingsData {
  ok: boolean;
  appVersion: string;
  apiVersion: string;
  environment: string;
  ollama: {
    baseUrl: string;
    defaultModel: string;
  };
  features: {
    fileWriteEnabled: boolean;
    fileWriteRequiresApproval: boolean;
    workspaceFilesEnabled: boolean;
    projectLibraryEnabled: boolean;
    projectLibraryReadOnly: boolean;
    draftsEnabled: boolean;
    emailSendEnabled: boolean;
    terminalToolsEnabled: boolean;
    cloudAiEnabled: boolean;
    localTtsEnabled: boolean;
  };
  safety: {
    ollamaOnly: boolean;
    workspaceLabel: string;
  };
}

interface OllamaStatusData {
  ok: boolean;
  baseUrl: string;
  configuredDefaultModel: string;
  resolvedDefaultModel: string | null;
  models: { name: string; size: number; modified_at: string }[];
  error?: string;
}

type ApiStatus = "checking" | "online" | "offline";

// ── Sub-components ────────────────────────────────────────────────────────────

type BadgeVariant =
  | "enabled"
  | "disabled"
  | "approval"
  | "local"
  | "readonly"
  | "planned"
  | "done";

function Badge({ variant, label }: { variant: BadgeVariant; label?: string }) {
  const styles: Record<BadgeVariant, string> = {
    enabled:  "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    disabled: "bg-slate-700/50 text-slate-500 border border-slate-700",
    approval: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    local:    "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
    readonly: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
    planned:  "bg-slate-700/30 text-slate-600 border border-slate-700/50",
    done:     "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  };
  const defaults: Record<BadgeVariant, string> = {
    enabled:  "enabled",
    disabled: "disabled",
    approval: "approval required",
    local:    "local only",
    readonly: "read-only",
    planned:  "planned",
    done:     "✓ done",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[variant]}`}>
      {label ?? defaults[variant]}
    </span>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
      <span className="text-sm text-slate-400 leading-snug">{label}</span>
      <div className="flex-shrink-0 text-right">{children}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-800/30 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
        {title}
      </h3>
      <div className="space-y-0 divide-y divide-slate-700/40">{children}</div>
    </div>
  );
}

function MonoValue({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-mono text-cyan-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">
      {children}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SettingsPanelProps {
  // Ollama model override managed by page.tsx and stored in localStorage.
  // null means "use backend default".
  modelOverride?: string | null;
  // Called when the user selects a model from the dropdown.
  onModelOverrideChange?: (model: string) => void;
  // Called when the user clicks Reset to default.
  onModelOverrideClear?: () => void;
  // Total number of memory notes in SQLite — passed from page.tsx which fetches
  // GET /memory on mount.  null = not yet loaded (shows "—").
  memoryCount?: number | null;
  // Number of memory notes currently selected for chat context injection.
  // Derived from selectedMemoryContext.length in page.tsx — always up to date.
  selectedMemoryCount?: number;
}

export default function SettingsPanel({
  modelOverride,
  onModelOverrideChange,
  onModelOverrideClear,
  memoryCount,
  selectedMemoryCount = 0,
}: SettingsPanelProps = {}) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [ollamaData, setOllamaData] = useState<OllamaStatusData | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch /settings, /health, and /ollama/status in parallel
    const p1 = fetch(`${API_URL}/settings`)
      .then((r) => r.json())
      .then((d: SettingsData) => {
        if (d.ok) setSettings(d);
        else setSettingsError(true);
      })
      .catch(() => setSettingsError(true));

    const p2 = fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((d: { ok: boolean }) => setApiStatus(d.ok ? "online" : "offline"))
      .catch(() => setApiStatus("offline"));

    const p3 = fetch(`${API_URL}/ollama/status`)
      .then((r) => r.json())
      .then((d: OllamaStatusData) => setOllamaData(d))
      .catch(() => {});

    void Promise.all([p1, p2, p3]).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-slate-500 animate-pulse">
          Loading settings…
        </p>
      </div>
    );
  }

  if (settingsError && !settings) {
    return (
      <div className="flex-1 flex items-center justify-center px-8 text-center">
        <p className="text-sm text-red-400/80">
          Could not load settings — is the Jarvis API running at{" "}
          <span className="font-mono text-xs">{API_URL}</span>?
        </p>
      </div>
    );
  }

  const feat = settings?.features;
  const ollamaConnected = ollamaData?.ok ?? false;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">

        {/* Page header */}
        <div className="border-b border-slate-800 pb-4">
          <h2 className="text-lg font-semibold text-slate-100 tracking-tight">
            Settings
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Most settings are read-only. The Ollama model selector below is a
            local browser preference — it does not modify <span className="font-mono">.env</span> or
            backend configuration.
          </p>
        </div>

        {/* ── A. About Jarvis ────────────────────────────────────────────── */}
        <Card title="About Jarvis">
          {/* Identity row */}
          <div className="flex items-center gap-2 py-1.5">
            <span className="text-sm font-semibold text-slate-200">Jarvis</span>
            <MonoValue>v{settings?.appVersion ?? "1.4.0"}</MonoValue>
            <Badge variant="done" label="stable" />
          </div>
          {/* One-line summary */}
          <div className="py-1.5">
            <p className="text-xs text-slate-500 leading-relaxed">
              Local-first personal AI assistant powered by Ollama.
              All AI processing runs on your machine — no data sent to cloud services.
            </p>
          </div>
          <SettingRow label="AI provider">
            <Badge variant="local" label="Ollama only" />
          </SettingRow>
          <SettingRow label="Cloud AI">
            <Badge variant="disabled" label="never" />
          </SettingRow>
          <SettingRow label="File writes">
            <Badge variant="approval" label="approval required" />
          </SettingRow>
          <SettingRow label="Memory injection">
            <Badge variant="enabled" label="opt-in only" />
          </SettingRow>
          <SettingRow label="Project Library">
            <Badge variant="readonly" label="read-only" />
          </SettingRow>
          <SettingRow label="Autonomous writes">
            <Badge variant="disabled" label="disabled" />
          </SettingRow>
          <SettingRow label="Email sending">
            <Badge variant="disabled" label="disabled" />
          </SettingRow>
        </Card>

        {/* ── B. Runtime ─────────────────────────────────────────────────── */}
        <Card title="Runtime">
          <SettingRow label="App version">
            <MonoValue>v{settings?.appVersion ?? "—"}</MonoValue>
          </SettingRow>
          <SettingRow label="API version">
            <div className="flex items-center gap-2">
              <MonoValue>v{settings?.apiVersion ?? "—"}</MonoValue>
              <Badge
                variant={
                  apiStatus === "online"
                    ? "enabled"
                    : apiStatus === "checking"
                    ? "approval"
                    : "disabled"
                }
                label={apiStatus}
              />
            </div>
          </SettingRow>
          <SettingRow label="Frontend">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Next.js 14</span>
              <Badge variant="enabled" label="online" />
            </div>
          </SettingRow>
          <SettingRow label="Environment">
            <Badge variant="local" label={settings?.environment ?? "local"} />
          </SettingRow>
        </Card>

        {/* ── C. Ollama ──────────────────────────────────────────────────── */}
        <Card title="Ollama — AI Provider">
          <SettingRow label="Provider">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300">Ollama</span>
              <Badge variant="local" label="only AI provider" />
            </div>
          </SettingRow>
          <SettingRow label="Base URL">
            <MonoValue>{settings?.ollama.baseUrl ?? "—"}</MonoValue>
          </SettingRow>
          <SettingRow label="Configured default">
            <MonoValue>{settings?.ollama.defaultModel ?? "—"}</MonoValue>
          </SettingRow>
          <SettingRow label="Active model">
            {/* Active model = override (if set) else resolved backend default */}
            {modelOverride ? (
              <MonoValue>{modelOverride}</MonoValue>
            ) : ollamaData?.ok && ollamaData.resolvedDefaultModel ? (
              <MonoValue>{ollamaData.resolvedDefaultModel}</MonoValue>
            ) : (
              <span className="text-xs text-slate-500">
                {ollamaConnected ? "—" : "not connected"}
              </span>
            )}
          </SettingRow>
          <SettingRow label="Source">
            {/* Shows whether the active model comes from a browser override or default config */}
            {modelOverride ? (
              <Badge variant="approval" label="browser override" />
            ) : (
              <Badge variant="disabled" label="default config" />
            )}
          </SettingRow>

          {/* ── Model selector ─────────────────────────────────────────── */}
          {ollamaConnected && ollamaData && ollamaData.models.length > 0 ? (
            <div className="py-2">
              <p className="text-xs text-slate-500 mb-1.5">Select active model</p>
              <div className="flex gap-2">
                <select
                  value={
                    modelOverride ??
                    ollamaData.resolvedDefaultModel ??
                    ollamaData.models[0]?.name ??
                    ""
                  }
                  onChange={(e) => onModelOverrideChange?.(e.target.value)}
                  className="flex-1 text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500/50 transition-colors"
                >
                  {ollamaData.models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {/* Reset button — only shown when an override is active */}
                {modelOverride && (
                  <button
                    onClick={onModelOverrideClear}
                    className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:border-red-500/40 hover:text-red-400 transition-colors whitespace-nowrap"
                  >
                    Reset to default
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Stored in browser localStorage · does not modify .env
              </p>
            </div>
          ) : !ollamaConnected ? (
            <div className="py-1.5">
              <p className="text-xs text-slate-600 italic">
                Connect Ollama to enable model selector.
              </p>
            </div>
          ) : null}

          <SettingRow label="Models available">
            <span className="text-sm text-slate-300">
              {ollamaData?.ok
                ? `${ollamaData.models.length} model${ollamaData.models.length !== 1 ? "s" : ""}`
                : "—"}
            </span>
          </SettingRow>
          <SettingRow label="Connection">
            <Badge
              variant={
                !ollamaData
                  ? "approval"
                  : ollamaData.ok
                  ? "enabled"
                  : "disabled"
              }
              label={
                !ollamaData ? "checking" : ollamaData.ok ? "connected" : "disconnected"
              }
            />
          </SettingRow>
          <SettingRow label="Cloud AI providers">
            <Badge variant="disabled" label="none — local only" />
          </SettingRow>
        </Card>

        {/* ── D. Memory ──────────────────────────────────────────────────── */}
        <Card title="Memory">
          {/* Live stats — sourced from page.tsx state (GET /memory on mount) */}
          <SettingRow label="Memory notes">
            <span className="text-sm text-slate-300">
              {memoryCount === null || memoryCount === undefined
                ? "—"
                : `${memoryCount} note${memoryCount !== 1 ? "s" : ""}`}
            </span>
          </SettingRow>
          <SettingRow label="Selected for this chat">
            {selectedMemoryCount > 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-purple-400 font-medium">
                  {selectedMemoryCount}
                </span>
                <Badge variant="enabled" label="active" />
              </div>
            ) : (
              <span className="text-sm text-slate-500">0</span>
            )}
          </SettingRow>
          {/* Static capability flags */}
          <SettingRow label="Memory types">
            <span className="text-xs text-slate-400">note · preference · project</span>
          </SettingRow>
          <SettingRow label="Content storage">
            <Badge variant="local" label="local SQLite" />
          </SettingRow>
          <SettingRow label="Selection storage">
            <span className="text-xs text-slate-400">localStorage IDs only</span>
          </SettingRow>
          <SettingRow label="Manual add/edit/delete">
            <Badge variant="enabled" label="enabled" />
          </SettingRow>
          <SettingRow label="Search and type filter">
            <Badge variant="enabled" label="enabled" />
          </SettingRow>
          <SettingRow label="Pinned memories">
            <Badge variant="enabled" label="enabled" />
          </SettingRow>
          <SettingRow label="Export/import">
            <Badge variant="enabled" label="enabled" />
          </SettingRow>
          <SettingRow label="Duplicate detection">
            <Badge variant="enabled" label="enabled" />
          </SettingRow>
          <SettingRow label="Manual context (opt-in)">
            <Badge variant="enabled" label="enabled" />
          </SettingRow>
          <SettingRow label="Persisted selection">
            <Badge variant="enabled" label="enabled" />
          </SettingRow>
          <SettingRow label="Auto injection">
            <Badge variant="disabled" label="disabled" />
          </SettingRow>
          <SettingRow label="Autonomous memory writes">
            <Badge variant="disabled" label="disabled" />
          </SettingRow>
          <SettingRow label="Sent to cloud">
            <Badge variant="disabled" label="never" />
          </SettingRow>
        </Card>

        {/* ── E. Safety ──────────────────────────────────────────────────── */}
        <Card title="Safety">
          <SettingRow label="File write">
            <Badge variant="approval" />
          </SettingRow>
          <SettingRow label="Workspace writes">
            <Badge variant="approval" label="approval required" />
          </SettingRow>
          <SettingRow label="Project Library">
            <Badge variant="readonly" />
          </SettingRow>
          <SettingRow label="Email sending">
            <Badge variant="disabled" />
          </SettingRow>
          <SettingRow label="Terminal tools">
            <Badge variant="disabled" />
          </SettingRow>
          <SettingRow label="Cloud AI providers">
            <Badge variant="disabled" />
          </SettingRow>
          <SettingRow label="AI provider scope">
            <Badge variant="local" label="Ollama only" />
          </SettingRow>
          <SettingRow label="Agent execution">
            <Badge variant="disabled" label="manual only" />
          </SettingRow>
          <SettingRow label="Agent step notes">
            <Badge variant="local" label="local / manual" />
          </SettingRow>
          <SettingRow label="Workspace overview">
            <Badge variant="local" label="read-only" />
          </SettingRow>
          <SettingRow label="Agent active step">
            <Badge variant="disabled" label="manual only" />
          </SettingRow>
        </Card>

        {/* ── F. Workspace ───────────────────────────────────────────────── */}
        <Card title="Workspace">
          <SettingRow label="Workspace root">
            <MonoValue>{settings?.safety.workspaceLabel ?? "workspace/"}</MonoValue>
          </SettingRow>
          <SettingRow label="Workspace Files">
            <Badge
              variant={feat?.workspaceFilesEnabled ? "enabled" : "disabled"}
            />
          </SettingRow>
          <SettingRow label="Project Library">
            <div className="flex items-center gap-2">
              <Badge
                variant={feat?.projectLibraryEnabled ? "enabled" : "disabled"}
              />
              {feat?.projectLibraryReadOnly && (
                <Badge variant="readonly" />
              )}
            </div>
          </SettingRow>
          <SettingRow label="Drafts folder">
            <Badge variant={feat?.draftsEnabled ? "enabled" : "disabled"} />
          </SettingRow>
          <SettingRow label="Local TTS">
            <Badge
              variant={feat?.localTtsEnabled ? "enabled" : "disabled"}
              label={feat?.localTtsEnabled ? "enabled" : "disabled"}
            />
          </SettingRow>
          <SettingRow label="Path traversal protection">
            <Badge variant="enabled" label="active" />
          </SettingRow>
        </Card>

        {/* ── G. Feature status ──────────────────────────────────────────── */}
        <Card title="Feature Status">
          {/* Completed */}
          <SettingRow label="Chat (streaming)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Multiple chat sessions">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Persistent chat history (SQLite)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Workspace Files browser">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Write-with-approval flow">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Project Library">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Local email drafts">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Voice / TTS controls">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Right sidebar tabs">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Settings panel (read-only)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Ollama model selector (browser)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Memory foundation (manual, local SQLite)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Memory opt-in chat context">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Persistent memory selection (localStorage)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Memory nav badge">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Memory stats in Settings">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Chat active model indicator">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Per-message model stamp">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Edit memory notes">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Memory type filter and improved search">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Pin/favorite memories">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Memory export/import">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Memory cleanup / duplicate detection">
            <Badge variant="done" />
          </SettingRow>

          {/* Planned */}
          <SettingRow label="Smart Home / Home Assistant">
            <Badge variant="planned" />
          </SettingRow>
          <SettingRow label="Settings editing (full)">
            <Badge variant="planned" />
          </SettingRow>
          <SettingRow label="Full voice assistant">
            <Badge variant="planned" />
          </SettingRow>
          <SettingRow label="Real email integration">
            <Badge variant="planned" />
          </SettingRow>
          <SettingRow label="Multi-file proposals">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Multi-file proposal template helper">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Multi-file proposal validation UI">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Per-file approve/skip for multi-file proposals">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Agent workflow foundation (planning only)">
            <Badge variant="done" label="✓ foundation" />
          </SettingRow>
          <SettingRow label="Agent plan persistence (per-session)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Agent plan step notes (manual/local)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Agent active step indicator (manual)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Agent next-action prompt helper">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Agent plan progress summary">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Workspace intelligence foundation (read-only)">
            <Badge variant="done" />
          </SettingRow>
          <SettingRow label="Agent autonomous execution">
            <Badge variant="disabled" label="never" />
          </SettingRow>
          <SettingRow label="Agent workflows (full)">
            <Badge variant="planned" />
          </SettingRow>
        </Card>

        {/* Footer note */}
        <p className="text-xs text-slate-600 text-center pb-2">
          Jarvis v{settings?.appVersion ?? "1.4.0"} — local-first AI assistant ·
          No data sent to cloud services
        </p>
      </div>
    </div>
  );
}

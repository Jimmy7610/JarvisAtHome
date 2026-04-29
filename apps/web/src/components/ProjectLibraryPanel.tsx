"use client";

// Project Library panel — read-only browser for workspace/projects/.
// Lists top-level projects, lets the user drill into files, and previews text files.
// v0.7.0: foundation — list projects, list files, read files. No writes.
// v0.7.3: frontend search/filter on the loaded file list.

import { useState, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
};

type ListProjectsResponse = {
  ok: boolean;
  projectsRoot?: string;
  projects?: ProjectEntry[];
  error?: string;
};

type ListFilesResponse = {
  ok: boolean;
  project?: string;
  files?: ProjectEntry[];
  error?: string;
};

type ReadFileResponse = {
  ok: boolean;
  project?: string;
  path?: string;
  content?: string;
  size?: number;
  error?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

// File type icon — returns a short emoji/symbol for the file extension
function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["md", "txt"].includes(ext)) return "📄";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return "⚙️";
  if (["json", "yml", "yaml"].includes(ext)) return "🗂️";
  if (["css", "html", "htm"].includes(ext)) return "🎨";
  if (["sh", "ps1"].includes(ext)) return "🖥️";
  return "📄";
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  onActivity?: (text: string, type?: "info" | "write" | "error") => void;
  /** Called when the user clicks "Attach to chat" on a previewed file. */
  onAttachFile?: (
    projectName: string,
    filePath: string,
    content: string,
    size: number
  ) => void;
  /**
   * Called when the user clicks "Ask Jarvis about this file".
   * Attaches the file AND prefills the chat input with a suggested question.
   * Nothing is sent automatically — the user edits and presses Send.
   */
  onAskAboutFile?: (
    projectName: string,
    filePath: string,
    content: string,
    size: number
  ) => void;
};

type PanelView =
  | { kind: "projects" }
  | { kind: "files"; projectName: string }
  | { kind: "file"; projectName: string; filePath: string };

export default function ProjectLibraryPanel({ onActivity, onAttachFile, onAskAboutFile }: Props) {
  // Which view is currently shown
  const [view, setView] = useState<PanelView>({ kind: "projects" });

  // Data state
  const [projects, setProjects] = useState<ProjectEntry[] | null>(null);
  const [files, setFiles] = useState<ProjectEntry[] | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);

  // Loading / error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search query — applies to the file list view only.
  // Cleared automatically when switching projects or navigating back.
  const [searchQuery, setSearchQuery] = useState("");

  // ─── Data fetchers ──────────────────────────────────────────────────────────

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/projects`);
      const data: ListProjectsResponse = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Failed to load projects.");
        onActivity?.(`Project Library: ${data.error ?? "load error"}`, "error");
      } else {
        setProjects(data.projects ?? []);
        onActivity?.("Project Library: projects loaded", "info");
      }
    } catch {
      setError("Cannot reach the Jarvis API.");
      onActivity?.("Project Library: API unreachable", "error");
    } finally {
      setLoading(false);
    }
  }, [onActivity]);

  const fetchFiles = useCallback(
    async (projectName: string) => {
      setLoading(true);
      setError(null);
      setFiles(null);
      try {
        const res = await fetch(
          `${API_URL}/projects/${encodeURIComponent(projectName)}`
        );
        const data: ListFilesResponse = await res.json();
        if (!data.ok) {
          setError(data.error ?? "Failed to load project files.");
          onActivity?.(
            `Project Library: ${data.error ?? "load error"}`,
            "error"
          );
        } else {
          setFiles(data.files ?? []);
          onActivity?.(
            `Project Library: opened project "${projectName}"`,
            "info"
          );
        }
      } catch {
        setError("Cannot reach the Jarvis API.");
        onActivity?.("Project Library: API unreachable", "error");
      } finally {
        setLoading(false);
      }
    },
    [onActivity]
  );

  const fetchFile = useCallback(
    async (projectName: string, filePath: string) => {
      setLoading(true);
      setError(null);
      setFileContent(null);
      setFileSize(null);
      try {
        const res = await fetch(
          `${API_URL}/projects/${encodeURIComponent(projectName)}/file?path=${encodeURIComponent(filePath)}`
        );
        const data: ReadFileResponse = await res.json();
        if (!data.ok) {
          setError(data.error ?? "Failed to read file.");
          onActivity?.(
            `Project Library: ${data.error ?? "read error"}`,
            "error"
          );
        } else {
          setFileContent(data.content ?? "");
          setFileSize(data.size ?? null);
          onActivity?.(
            `Project Library: opened "${filePath}" in "${projectName}"`,
            "info"
          );
        }
      } catch {
        setError("Cannot reach the Jarvis API.");
        onActivity?.("Project Library: API unreachable", "error");
      } finally {
        setLoading(false);
      }
    },
    [onActivity]
  );

  // ─── Navigation handlers ────────────────────────────────────────────────────

  function handleOpenPanel() {
    setView({ kind: "projects" });
    setProjects(null);
    setError(null);
    setSearchQuery("");
    void fetchProjects();
  }

  function handleSelectProject(projectName: string) {
    // Clear search so we always start with a full list for a new project
    setSearchQuery("");
    setView({ kind: "files", projectName });
    void fetchFiles(projectName);
  }

  function handleSelectFile(projectName: string, filePath: string) {
    setView({ kind: "file", projectName, filePath });
    void fetchFile(projectName, filePath);
  }

  function handleBackToProjects() {
    setSearchQuery("");
    setView({ kind: "projects" });
    if (!projects) void fetchProjects();
  }

  function handleBackToFiles(projectName: string) {
    setView({ kind: "files", projectName });
    if (!files) void fetchFiles(projectName);
  }

  function handleRefresh() {
    if (view.kind === "projects") {
      void fetchProjects();
    } else if (view.kind === "files") {
      void fetchFiles(view.projectName);
    } else if (view.kind === "file") {
      void fetchFile(view.projectName, view.filePath);
    }
  }

  // ─── Render helpers ─────────────────────────────────────────────────────────

  function renderHeader() {
    return (
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          {/* Breadcrumb */}
          {view.kind === "projects" && (
            <span className="text-xs text-cyan-400 font-medium truncate">
              Projects
            </span>
          )}
          {view.kind === "files" && (
            <div className="flex items-center gap-1 min-w-0">
              <button
                onClick={handleBackToProjects}
                className="text-xs text-slate-400 hover:text-cyan-400 transition-colors shrink-0"
              >
                Projects
              </button>
              <span className="text-xs text-slate-600 shrink-0">/</span>
              <span className="text-xs text-cyan-400 font-medium truncate">
                {view.projectName}
              </span>
            </div>
          )}
          {view.kind === "file" && (
            <div className="flex items-center gap-1 min-w-0">
              <button
                onClick={handleBackToProjects}
                className="text-xs text-slate-400 hover:text-cyan-400 transition-colors shrink-0"
              >
                Projects
              </button>
              <span className="text-xs text-slate-600 shrink-0">/</span>
              <button
                onClick={() => handleBackToFiles(view.projectName)}
                className="text-xs text-slate-400 hover:text-cyan-400 transition-colors shrink-0"
              >
                {view.projectName}
              </button>
              <span className="text-xs text-slate-600 shrink-0">/</span>
              <span className="text-xs text-cyan-400 font-medium truncate">
                {view.filePath.split("/").pop()}
              </span>
            </div>
          )}
        </div>

        {/* Refresh button */}
        {projects !== null || view.kind !== "projects" ? (
          <button
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh"
            className="text-slate-500 hover:text-cyan-400 transition-colors text-xs px-1 disabled:opacity-40 shrink-0"
          >
            ↻
          </button>
        ) : null}
      </div>
    );
  }

  function renderProjectList() {
    if (projects === null && !loading && !error) {
      // Initial state — panel not yet opened / data not fetched
      return (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-4 text-center">
          <span className="text-2xl">📁</span>
          <p className="text-xs text-slate-400">
            Browse projects in{" "}
            <span className="text-slate-300">workspace/projects/</span>
          </p>
          <button
            onClick={handleOpenPanel}
            className="mt-1 px-3 py-1.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs transition-colors"
          >
            Open Project Library
          </button>
        </div>
      );
    }

    if (loading) return renderLoading();
    if (error) return renderError();

    if (projects !== null && projects.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-4 text-center">
          <span className="text-2xl">📭</span>
          <p className="text-xs text-slate-400">
            No projects found in{" "}
            <span className="text-slate-300">workspace/projects/</span>
          </p>
          <p className="text-xs text-slate-600">
            Create a subdirectory to get started.
          </p>
        </div>
      );
    }

    return (
      <ul className="overflow-y-auto flex-1 py-1">
        {(projects ?? []).map((p) => (
          <li key={p.name}>
            <button
              onClick={() => handleSelectProject(p.name)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/60 text-left transition-colors group"
            >
              <span className="text-base shrink-0">📁</span>
              <span className="text-xs text-slate-200 truncate group-hover:text-cyan-300 transition-colors">
                {p.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  function renderFileList() {
    if (loading) return renderLoading();
    if (error) return renderError();
    if (!files) return null;

    const projectName = view.kind === "files" ? view.projectName : "";
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const isSearching = trimmedQuery.length > 0;

    // When searching: show only file entries whose path or name matches.
    // Directory header entries are hidden — they have no meaning without children.
    // When not searching: show the full original list (files + directory headers).
    const displayEntries = isSearching
      ? files.filter(
          (e) =>
            e.type === "file" &&
            (e.path.toLowerCase().includes(trimmedQuery) ||
              e.name.toLowerCase().includes(trimmedQuery))
        )
      : files;

    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Search input — only shown when a project has files to search */}
        {files.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-800 flex-shrink-0">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search project files…"
              className="w-full rounded bg-slate-800/60 border border-slate-700 px-2.5 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
            {/* Match count — only shown while a query is active */}
            {isSearching && (
              <p className="mt-1 text-xs text-slate-500">
                {displayEntries.length === 0
                  ? "No matching files."
                  : `${displayEntries.length} match${displayEntries.length !== 1 ? "es" : ""}`}
              </p>
            )}
          </div>
        )}

        {/* Empty project (no files at all) */}
        {files.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 px-4 text-center">
            <span className="text-2xl">📭</span>
            <p className="text-xs text-slate-400">No readable files found.</p>
            <p className="text-xs text-slate-600">
              Add .md, .ts, .json, or other text files.
            </p>
          </div>
        )}

        {/* File list — normal tree view or filtered flat results */}
        {displayEntries.length > 0 ? (
          <ul className="overflow-y-auto flex-1 py-1">
            {displayEntries.map((entry) => {
              // Directory header row (only visible when not searching)
              if (entry.type === "directory") {
                return (
                  <li key={entry.path}>
                    <div className="flex items-center gap-2 px-3 py-1 opacity-70">
                      <span className="text-xs shrink-0">📂</span>
                      <span className="text-xs text-slate-400 truncate font-medium">
                        {entry.path}
                      </span>
                    </div>
                  </li>
                );
              }

              // Clickable file row
              return (
                <li key={entry.path}>
                  <button
                    onClick={() => handleSelectFile(projectName, entry.path)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/60 text-left transition-colors group"
                  >
                    <span className="text-xs shrink-0">
                      {fileIcon(entry.name)}
                    </span>
                    <span className="text-xs text-slate-300 truncate group-hover:text-cyan-300 transition-colors flex-1 min-w-0">
                      {entry.path}
                    </span>
                    {entry.size !== undefined && (
                      <span className="text-xs text-slate-600 shrink-0">
                        {formatBytes(entry.size)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          /* No search matches — only shown when a query produced zero results */
          isSearching && (
            <div className="flex flex-col items-center justify-center flex-1 gap-1 px-4 text-center">
              <span className="text-lg">🔍</span>
              <p className="text-xs text-slate-500">No matching files.</p>
              <button
                onClick={() => setSearchQuery("")}
                className="text-xs text-slate-600 hover:text-cyan-400 transition-colors"
              >
                Clear search
              </button>
            </div>
          )
        )}
      </div>
    );
  }

  function renderFileContent() {
    if (loading) return renderLoading();
    if (error) return renderError();

    // Buttons are only active when a file is fully loaded and not currently loading.
    const fileReady = view.kind === "file" && fileContent !== null && !loading;

    function handleAttach() {
      if (!fileReady || view.kind !== "file") return;
      onAttachFile!(view.projectName, view.filePath, fileContent!, fileSize ?? 0);
      onActivity?.(
        `Attached project file ${view.projectName}/${view.filePath} to chat`,
        "info"
      );
    }

    function handleAsk() {
      if (!fileReady || view.kind !== "file") return;
      onAskAboutFile!(view.projectName, view.filePath, fileContent!, fileSize ?? 0);
      onActivity?.(
        `Project file queued for question: ${view.projectName}/${view.filePath}`,
        "info"
      );
    }

    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* File metadata + action buttons */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-800 flex-shrink-0 flex-wrap">
          <span className="text-xs text-slate-500 shrink-0">
            {fileSize !== null ? formatBytes(fileSize) : ""}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Ask Jarvis about this file — attaches file AND prefills chat input */}
            {onAskAboutFile && (
              <button
                type="button"
                onClick={handleAsk}
                disabled={!fileReady}
                title="Attach this file and prefill a question in chat"
                className="text-xs px-2 py-0.5 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                Ask Jarvis
              </button>
            )}
            {/* Attach to chat — attaches file only, no prefill */}
            {onAttachFile && (
              <button
                type="button"
                onClick={handleAttach}
                disabled={!fileReady}
                title="Attach this file to the chat input"
                className="text-xs px-2 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                Attach
              </button>
            )}
          </div>
        </div>
        {/* File content */}
        <div className="flex-1 overflow-y-auto">
          <pre className="px-3 py-2 text-xs text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed">
            {fileContent ?? ""}
          </pre>
        </div>
      </div>
    );
  }

  function renderLoading() {
    return (
      <div className="flex items-center justify-center flex-1">
        <span className="text-xs text-slate-500 animate-pulse">Loading…</span>
      </div>
    );
  }

  function renderError() {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 px-3 text-center">
        <span className="text-lg">⚠️</span>
        <p className="text-xs text-red-400">{error}</p>
        <button
          onClick={handleRefresh}
          className="text-xs text-slate-400 hover:text-cyan-400 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full border-t border-slate-800 bg-[#0d1120]">
      {/* Panel title */}
      <div className="px-3 pt-3 pb-1 flex-shrink-0">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Project Library
        </h2>
      </div>

      {/* Breadcrumb / header */}
      {renderHeader()}

      {/* Body */}
      <div className="flex flex-col flex-1 min-h-0">
        {view.kind === "projects" && renderProjectList()}
        {view.kind === "files" && renderFileList()}
        {view.kind === "file" && renderFileContent()}
      </div>
    </div>
  );
}

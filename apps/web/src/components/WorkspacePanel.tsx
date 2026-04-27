"use client";

// Workspace file browser — read-only view of the Jarvis sandbox workspace.
// Files can be listed and read; no write, edit, delete, or move actions exist.
// v0.2.3: supports subdirectory navigation with breadcrumb path indicator.

import { useState, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
};

type ListResponse = {
  ok: boolean;
  root?: string;
  path?: string;
  entries?: FileEntry[];
  error?: string;
};

type ReadResponse = {
  ok: boolean;
  path?: string;
  content?: string;
  size?: number;
  error?: string;
};

// Format a byte count as a compact human-readable string
function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

// Build breadcrumb segments from a relative directory path.
// ""         → [{ label: "workspace", path: "" }]
// "drafts"   → [{ label: "workspace", path: "" }, { label: "drafts", path: "drafts" }]
function buildBreadcrumbs(
  dirPath: string
): Array<{ label: string; path: string }> {
  const crumbs: Array<{ label: string; path: string }> = [
    { label: "workspace", path: "" },
  ];
  if (!dirPath) return crumbs;
  const parts = dirPath.split("/").filter(Boolean);
  let accumulated = "";
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    crumbs.push({ label: part, path: accumulated });
  }
  return crumbs;
}

export default function WorkspacePanel({
  onAttachFile,
}: {
  onAttachFile?: (path: string, content: string, size: number) => void;
} = {}) {
  // Currently browsed directory (relative path from workspace root; "" = root)
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<number>(0);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  // true once the user has clicked "Attach to chat" for the currently previewed file
  const [attached, setAttached] = useState(false);

  // Reload the listing whenever the current directory changes
  useEffect(() => {
    void fetchList(currentPath);
  }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchList(dirPath: string): Promise<void> {
    setListLoading(true);
    setListError(null);
    try {
      const url = dirPath
        ? `${API_URL}/files/list?path=${encodeURIComponent(dirPath)}`
        : `${API_URL}/files/list`;
      const res = await fetch(url);
      const data = (await res.json()) as ListResponse;
      if (!data.ok) {
        setListError(data.error ?? "Failed to list workspace files.");
        return;
      }
      setEntries(data.entries ?? []);
    } catch {
      setListError("API unreachable — is the Jarvis API running?");
    } finally {
      setListLoading(false);
    }
  }

  // Navigate to a directory. Clears the file preview if the selected file
  // does not live directly inside the destination directory.
  function navigateTo(dirPath: string): void {
    if (selectedPath !== null) {
      // A file belongs to a folder if it is a direct child of that folder.
      // Root children have no "/" in their path; subdir children start with "dirPath/".
      const fileBelongs =
        dirPath === ""
          ? !selectedPath.includes("/")
          : selectedPath.startsWith(dirPath + "/");
      if (!fileBelongs) closePreview();
    }
    setCurrentPath(dirPath);
  }

  function navigateUp(): void {
    if (!currentPath) return; // already at root
    const parts = currentPath.split("/");
    parts.pop();
    navigateTo(parts.join("/"));
  }

  async function handleSelectFile(filePath: string): Promise<void> {
    setSelectedPath(filePath);
    setSelectedSize(0);
    setFileContent(null);
    setFileError(null);
    setFileLoading(true);
    setAttached(false);
    try {
      const res = await fetch(
        `${API_URL}/files/read?path=${encodeURIComponent(filePath)}`
      );
      const data = (await res.json()) as ReadResponse;
      if (!data.ok) {
        setFileError(data.error ?? "Failed to read file.");
        return;
      }
      setFileContent(data.content ?? "");
      setSelectedSize(data.size ?? 0);
    } catch {
      setFileError("API unreachable.");
    } finally {
      setFileLoading(false);
    }
  }

  function closePreview(): void {
    setSelectedPath(null);
    setFileContent(null);
    setFileError(null);
    setAttached(false);
  }

  function handleAttach(): void {
    if (!selectedPath || fileContent === null || !onAttachFile) return;
    onAttachFile(selectedPath, fileContent, selectedSize);
    setAttached(true);
  }

  const breadcrumbs = buildBreadcrumbs(currentPath);
  const isAtRoot = currentPath === "";

  return (
    <div className="flex flex-col overflow-hidden border-t border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0 border-b border-slate-800">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Workspace Files
        </span>
        <span className="text-xs text-slate-700 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700">
          Read-only
        </span>
      </div>

      {/* Breadcrumb / path indicator */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-800/60 flex-shrink-0 min-w-0">
        {/* Up button — only shown when not at root */}
        {!isAtRoot && (
          <button
            onClick={navigateUp}
            className="flex-shrink-0 text-slate-600 hover:text-slate-400 transition-colors text-xs mr-0.5"
            title="Go up one level"
            aria-label="Go up"
          >
            ↑
          </button>
        )}
        {/* Clickable breadcrumb segments */}
        <div className="flex items-center min-w-0 overflow-hidden text-xs">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span
                key={crumb.path}
                className="flex items-center min-w-0 flex-shrink-0"
              >
                {i > 0 && (
                  <span className="text-slate-800 px-0.5 flex-shrink-0">/</span>
                )}
                {isLast ? (
                  <span className="text-slate-400 truncate">{crumb.label}</span>
                ) : (
                  <button
                    onClick={() => navigateTo(crumb.path)}
                    className="text-slate-600 hover:text-slate-400 transition-colors truncate"
                    title={`Go to ${crumb.label}`}
                  >
                    {crumb.label}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* File / directory listing */}
      <div
        className="overflow-y-auto px-3 py-2 space-y-px"
        style={{ maxHeight: "120px" }}
      >
        {listLoading && (
          <p className="text-xs text-slate-600 px-1 py-1">Loading…</p>
        )}
        {listError && (
          <p className="text-xs text-red-500/70 px-1 py-1 leading-relaxed">
            {listError}
          </p>
        )}
        {!listLoading && !listError && entries.length === 0 && (
          <p className="text-xs text-slate-600 px-1 py-1">
            {isAtRoot ? "No files in workspace yet." : "Empty folder."}
          </p>
        )}
        {!listLoading &&
          entries.map((entry) => {
            if (entry.type === "directory") {
              return (
                <button
                  key={entry.path}
                  onClick={() => navigateTo(entry.path)}
                  className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-xs text-slate-500 hover:bg-slate-800/60 hover:text-slate-300 transition-colors"
                  title={`Open ${entry.name}/`}
                >
                  <span className="text-slate-600 flex-shrink-0">▸</span>
                  <span className="truncate">{entry.name}/</span>
                </button>
              );
            }

            const isSelected = entry.path === selectedPath;
            return (
              <button
                key={entry.path}
                onClick={() => void handleSelectFile(entry.path)}
                className={`w-full text-left flex items-center justify-between gap-2 px-2 py-1 rounded text-xs transition-colors
                  ${
                    isSelected
                      ? "bg-slate-700/60 text-slate-200"
                      : "text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                  }`}
                title={entry.path}
              >
                <span className="truncate">{entry.name}</span>
                {entry.size !== undefined && (
                  <span className="flex-shrink-0 text-slate-700 tabular-nums">
                    {formatBytes(entry.size)}
                  </span>
                )}
              </button>
            );
          })}
      </div>

      {/* File preview — shown when a file is selected */}
      {selectedPath && (
        <div
          className="flex flex-col border-t border-slate-800 flex-shrink-0"
          style={{ maxHeight: "160px" }}
        >
          {/* Preview header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/60 flex-shrink-0">
            <span
              className="text-xs text-slate-500 truncate"
              title={selectedPath}
            >
              {selectedPath}
            </span>
            <button
              onClick={closePreview}
              className="flex-shrink-0 ml-2 text-slate-700 hover:text-slate-400 text-sm leading-none"
              aria-label="Close preview"
            >
              ×
            </button>
          </div>

          {/* Preview content */}
          <div className="overflow-y-auto px-3 py-2 flex-1">
            {fileLoading && (
              <p className="text-xs text-slate-600">Loading…</p>
            )}
            {fileError && (
              <p className="text-xs text-red-500/70 leading-relaxed">
                {fileError}
              </p>
            )}
            {fileContent !== null && (
              <pre className="text-xs text-slate-400 whitespace-pre-wrap break-words font-mono leading-relaxed">
                {fileContent}
              </pre>
            )}
          </div>

          {/* Attach to chat button — only shown when file is loaded */}
          {fileContent !== null && onAttachFile && (
            <div className="flex-shrink-0 px-3 py-2 border-t border-slate-800/60">
              {attached ? (
                <p className="text-xs text-cyan-600 text-center">
                  ✓ Attached — will be included in your next message
                </p>
              ) : (
                <button
                  onClick={handleAttach}
                  className="w-full text-xs py-1.5 rounded bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                >
                  Attach to chat
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// Workspace file browser — read-only view of the Jarvis sandbox workspace.
// Files can be listed and read; no write, edit, delete, or move actions exist.
// v0.2.3: subdirectory navigation with breadcrumb path indicator.
// v0.2.5: manual refresh button reloads the current folder listing.
// v0.7.4: search/filter over the current directory listing.

import { useState, useEffect, useRef } from "react";

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

// ── Workspace overview types ──────────────────────────────────────────────────
// Mirrors the shape returned by GET /files/overview.
// Paths are always workspace-relative — never absolute.

type OverviewData = {
  totalFiles: number;
  totalDirectories: number;
  scannedFiles: number;
  capped: boolean;
  extensions: Array<{ ext: string; count: number }>;
  largestFiles: Array<{ path: string; size: number }>;
  recentFiles: Array<{ path: string; size: number; modifiedAt: string }>;
  hints: {
    hasReadme: boolean;
    hasPackageJson: boolean;
    hasTsConfig: boolean;
    hasMakefile: boolean;
  };
};

type OverviewResponse = { ok: boolean; error?: string } & Partial<OverviewData>;

// ─── Write proposal types (mirrors backend writeTools.ts) ─────────────────────

type DiffLine = {
  type: "unchanged" | "added" | "removed";
  content: string;
};

type Proposal = {
  id: string;
  path: string;
  diff: DiffLine[];
};

// A display line is either a diff line or a collapsed-context gap indicator
type DisplayLine =
  | DiffLine
  | { type: "gap"; count: number };

// Collapse long unchanged sections to at most CONTEXT lines on each side of a change.
const DIFF_CONTEXT = 5;

function getDisplayLines(diff: DiffLine[]): DisplayLine[] {
  const firstChange = diff.findIndex((l) => l.type !== "unchanged");
  if (firstChange === -1) {
    // No changes — show up to the last CONTEXT lines with a gap above
    if (diff.length <= DIFF_CONTEXT) return [...diff];
    return [
      { type: "gap", count: diff.length - DIFF_CONTEXT },
      ...diff.slice(diff.length - DIFF_CONTEXT),
    ];
  }

  const lastChange =
    diff.length -
    1 -
    [...diff].reverse().findIndex((l) => l.type !== "unchanged");

  const result: DisplayLine[] = [];

  // Leading context (up to CONTEXT lines before first change)
  const leadStart = Math.max(0, firstChange - DIFF_CONTEXT);
  if (leadStart > 0) result.push({ type: "gap", count: leadStart });
  for (let i = leadStart; i < firstChange; i++) result.push(diff[i]);

  // All changed lines
  for (let i = firstChange; i <= lastChange; i++) result.push(diff[i]);

  // Trailing context (up to CONTEXT lines after last change)
  const trailEnd = Math.min(diff.length - 1, lastChange + DIFF_CONTEXT);
  for (let i = lastChange + 1; i <= trailEnd; i++) result.push(diff[i]);
  if (trailEnd < diff.length - 1)
    result.push({ type: "gap", count: diff.length - 1 - trailEnd });

  return result;
}

// Build a structured plain-text prompt from workspace overview data.
// Used by the "Ask Jarvis about this workspace" button to pre-fill the chat input.
// Never includes file contents — workspace metadata only (paths, sizes, dates).
function generateOverviewPrompt(data: OverviewData): string {
  const lines: string[] = [
    "I want you to analyze this workspace overview and suggest safe next improvements.",
    "",
    "Workspace overview:",
    `- Total files: ${data.totalFiles}`,
    `- Total folders: ${data.totalDirectories}`,
  ];
  if (data.capped) {
    lines.push(
      `- Note: scan was capped at ${data.scannedFiles} files (workspace may be larger)`
    );
  }
  if (data.extensions.length > 0) {
    const extSummary = data.extensions
      .slice(0, 8)
      .map(({ ext, count }) => `${ext} (${count})`)
      .join(", ");
    lines.push(`- Top file types: ${extSummary}`);
  }
  if (data.largestFiles.length > 0) {
    lines.push("- Largest files:");
    for (const { path: fp, size } of data.largestFiles) {
      lines.push(`  - ${fp} (${formatBytes(size)})`);
    }
  }
  if (data.recentFiles.length > 0) {
    lines.push("- Recently modified:");
    for (const { path: fp, modifiedAt } of data.recentFiles) {
      lines.push(`  - ${fp} (${new Date(modifiedAt).toLocaleDateString()})`);
    }
  }
  const hintLines: string[] = [];
  if (data.hints.hasReadme) hintLines.push("README");
  if (data.hints.hasPackageJson) hintLines.push("package.json");
  if (data.hints.hasTsConfig) hintLines.push("tsconfig.json");
  if (data.hints.hasMakefile) hintLines.push("Makefile");
  if (hintLines.length > 0) {
    lines.push(`- Detected project files: ${hintLines.join(", ")}`);
  }
  lines.push(
    "",
    "Please suggest safe next improvements. Do not write files directly." +
      " If file changes are needed, use a jarvis-write-proposal block and wait for approval."
  );
  return lines.join("\n");
}

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
  onAskAboutFile,
  onAskAboutOverview,
  onActivity,
  openFileRequest,
  onOpenFileRequestConsumed,
}: {
  onAttachFile?: (path: string, content: string, size: number) => void;
  // Attaches the file AND prefills a suggested question in the chat input.
  // Nothing is sent automatically — user edits and presses Send.
  onAskAboutFile?: (path: string, content: string, size: number) => void;
  // Called when the user clicks "Ask Jarvis about this workspace" in the overview.
  // Receives a structured prompt built from overview metadata (no file contents).
  // Parent sets prefillInput and switches to chat view — nothing sent automatically.
  onAskAboutOverview?: (prompt: string) => void;
  // Reports a named activity event to the parent for display in ActivityPanel.
  onActivity?: (text: string, type?: "info" | "write" | "error") => void;
  // When set, WorkspacePanel navigates to the file's folder and opens a preview.
  // Used by ChatPanel to auto-open a newly approved draft.
  openFileRequest?: string | null;
  // Called immediately after WorkspacePanel consumes openFileRequest so the parent
  // can reset the value without an infinite effect loop.
  onOpenFileRequestConsumed?: () => void;
} = {}) {
  // Currently browsed directory (relative path from workspace root; "" = root)
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Search query — filters the current directory listing by name or path.
  // Cleared automatically when navigating to a different directory.
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<number>(0);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  // true once the user has clicked "Attach to chat" for the currently previewed file
  const [attached, setAttached] = useState(false);
  // true when "Ask Jarvis about this file" was used (shows a different confirmation)
  const [asked, setAsked] = useState(false);

  // Pending file to open after the next directory listing completes.
  // Stored in a ref (not state) so setting it does not trigger a re-render.
  const pendingOpenFileRef = useRef<string | null>(null);

  // ── Write proposal state ────────────────────────────────────────────────────
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [approveLoading, setApproveLoading] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  // true after a successful write — cleared on file switch or preview close
  const [writeSuccess, setWriteSuccess] = useState(false);

  // ── Workspace overview state ────────────────────────────────────────────────
  // showOverview: true → overview panel is shown instead of the file browser.
  // Fetched on demand (not on mount) to avoid an unnecessary scan at startup.
  const [showOverview, setShowOverview] = useState(false);
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Reload the listing whenever the current directory changes.
  // After loading, auto-selects a pending file if one was set via openFileRequest.
  useEffect(() => {
    async function loadAndMaybeOpen(): Promise<void> {
      const newEntries = await fetchList(currentPath);
      const pending = pendingOpenFileRef.current;
      if (!pending) return;
      const found = newEntries.some(
        (e) => e.type === "file" && e.path === pending
      );
      pendingOpenFileRef.current = null;
      if (found) await handleSelectFile(pending);
    }
    void loadAndMaybeOpen();
  }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the parent requests a file to be opened, navigate to its folder (if
  // needed) and queue the file path for selection once the listing has loaded.
  // Consumes the request immediately so the parent can reset to null.
  useEffect(() => {
    if (!openFileRequest) return;
    onOpenFileRequestConsumed?.();

    const slashIdx = openFileRequest.lastIndexOf("/");
    const parentDir = slashIdx > 0 ? openFileRequest.slice(0, slashIdx) : "";
    pendingOpenFileRef.current = openFileRequest;

    if (currentPath !== parentDir) {
      // Navigate — the listing useEffect will fire and handle pendingOpenFileRef.
      navigateTo(parentDir);
    } else {
      // Already in the right folder — listing useEffect won't re-fire, so refresh
      // and auto-select manually (the newly created file may not be in the cache).
      async function refreshAndOpen(): Promise<void> {
        const newEntries = await fetchList(parentDir);
        const pending = pendingOpenFileRef.current;
        if (!pending) return;
        const found = newEntries.some(
          (e) => e.type === "file" && e.path === pending
        );
        pendingOpenFileRef.current = null;
        if (found) await handleSelectFile(pending);
      }
      void refreshAndOpen();
    }
  }, [openFileRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch a directory listing and update entries state.
  // Returns the fetched entries so callers can inspect them (e.g. refreshWorkspace).
  async function fetchList(dirPath: string): Promise<FileEntry[]> {
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
        return [];
      }
      const newEntries = data.entries ?? [];
      setEntries(newEntries);
      return newEntries;
    } catch {
      setListError("API unreachable — is the Jarvis API running?");
      return [];
    } finally {
      setListLoading(false);
    }
  }

  // Reload the current directory. Clears the file preview if the selected file
  // is no longer present in the refreshed listing.
  async function refreshWorkspace(): Promise<void> {
    const newEntries = await fetchList(currentPath);
    if (selectedPath !== null) {
      const stillExists = newEntries.some(
        (e) => e.type === "file" && e.path === selectedPath
      );
      if (!stillExists) closePreview();
    }
  }

  // Fetch workspace overview metadata from the backend.
  // Called on demand (when the user opens the overview or clicks Reload).
  // Never fetches file contents — metadata only.
  async function fetchOverview(): Promise<void> {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const res = await fetch(`${API_URL}/files/overview`);
      const data = (await res.json()) as OverviewResponse;
      if (!data.ok) {
        setOverviewError(data.error ?? "Failed to load workspace overview.");
        return;
      }
      setOverviewData(data as OverviewData);
    } catch {
      setOverviewError("API unreachable — is the Jarvis API running?");
    } finally {
      setOverviewLoading(false);
    }
  }

  // Navigate to a directory. Clears the file preview if the selected file
  // does not live directly inside the destination directory.
  // Also clears search so the new directory always starts with a full listing.
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
    setSearchQuery("");
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
    setAsked(false);
    // Clear proposal state when switching to a different file
    setProposal(null);
    setProposalError(null);
    setApproveError(null);
    setWriteSuccess(false);
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
    setAsked(false);
    setProposal(null);
    setProposalError(null);
    setApproveError(null);
    setWriteSuccess(false);
  }

  function handleAttach(): void {
    if (!selectedPath || fileContent === null || !onAttachFile) return;
    onAttachFile(selectedPath, fileContent, selectedSize);
    setAttached(true);
  }

  function handleAsk(): void {
    if (!selectedPath || fileContent === null || !onAskAboutFile) return;
    onAskAboutFile(selectedPath, fileContent, selectedSize);
    setAttached(true);
    setAsked(true);
  }

  // ── Write proposal handlers ─────────────────────────────────────────────────

  async function handleProposeEdit(): Promise<void> {
    if (!selectedPath || fileContent === null) return;
    setProposalLoading(true);
    setProposalError(null);
    setWriteSuccess(false);

    // v0.3.0 test edit: append a safe reviewer comment to the file
    const proposedContent =
      fileContent + "\n\n<!-- Proposed by Jarvis: review before keeping. -->\n";

    try {
      const res = await fetch(`${API_URL}/files/propose-write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, content: proposedContent }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        id?: string;
        path?: string;
        diff?: DiffLine[];
        error?: string;
      };
      if (!data.ok || !data.id || !data.diff) {
        const errMsg = data.error ?? "Failed to create proposal.";
        setProposalError(errMsg);
        onActivity?.(
          `Write proposal failed for ${selectedPath}: ${errMsg}`,
          "error"
        );
        return;
      }
      setProposal({ id: data.id, path: data.path ?? selectedPath, diff: data.diff });
      onActivity?.(
        `Write proposal created for workspace/${selectedPath}`,
        "write"
      );
    } catch {
      const errMsg = "API unreachable — is the Jarvis API running?";
      setProposalError(errMsg);
      onActivity?.(`Write proposal failed for ${selectedPath}: ${errMsg}`, "error");
    } finally {
      setProposalLoading(false);
    }
  }

  async function handleApprove(): Promise<void> {
    if (!proposal || !selectedPath) return;
    setApproveLoading(true);
    setApproveError(null);

    try {
      const res = await fetch(`${API_URL}/files/approve-write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.id }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        path?: string;
        written?: boolean;
        error?: string;
      };
      if (!data.ok) {
        const errMsg = data.error ?? "Failed to approve write.";
        setApproveError(errMsg);
        onActivity?.(
          `Write approval failed for ${selectedPath}: ${errMsg}`,
          "error"
        );
        return;
      }

      onActivity?.(
        `Write approved and applied to workspace/${selectedPath}`,
        "write"
      );

      // Clear proposal and show success, then reload the file content in-place
      setProposal(null);
      setWriteSuccess(true);
      setAttached(false);
      setAsked(false);

      // Reload the file content without resetting other state
      const reloadRes = await fetch(
        `${API_URL}/files/read?path=${encodeURIComponent(selectedPath)}`
      );
      const reloadData = (await reloadRes.json()) as {
        ok: boolean;
        content?: string;
        size?: number;
      };
      if (reloadData.ok) {
        setFileContent(reloadData.content ?? "");
        setSelectedSize(reloadData.size ?? 0);
      }

      // Refresh directory listing so the updated file size is shown
      void fetchList(currentPath);
    } catch {
      const errMsg = "API unreachable — is the Jarvis API running?";
      setApproveError(errMsg);
      onActivity?.(`Write approval failed for ${selectedPath}: ${errMsg}`, "error");
    } finally {
      setApproveLoading(false);
    }
  }

  // ── Overview file deep-link ─────────────────────────────────────────────────

  // Called when the user clicks a file path in the Workspace Overview panel.
  // Switches back to the file browser, navigates to the file's parent folder
  // (if different from the current directory), and opens a read-only preview —
  // identical to clicking the file in the normal file listing.
  // Read-only: no write, no modification, no deletion.
  function handleOverviewFileClick(filePath: string): void {
    // Return to the file browser view
    setShowOverview(false);

    const slashIdx = filePath.lastIndexOf("/");
    const parentDir = slashIdx > 0 ? filePath.slice(0, slashIdx) : "";

    // Emit activity event (path only, never content)
    onActivity?.(`Workspace overview file opened: ${filePath}`, "info");

    // Queue the file so the listing effect can select it after load
    pendingOpenFileRef.current = filePath;

    if (currentPath !== parentDir) {
      // navigateTo changes currentPath → triggers the listing useEffect
      // which calls fetchList and then handles pendingOpenFileRef
      navigateTo(parentDir);
    } else {
      // Already in the right folder — listing useEffect will not re-fire.
      // Refresh and auto-select manually (mirrors the openFileRequest handler).
      async function refreshAndOpen(): Promise<void> {
        const newEntries = await fetchList(parentDir);
        const pending = pendingOpenFileRef.current;
        if (!pending) return;
        const found = newEntries.some(
          (e) => e.type === "file" && e.path === pending
        );
        pendingOpenFileRef.current = null;
        if (found) await handleSelectFile(pending);
      }
      void refreshAndOpen();
    }
  }

  function handleCancelProposal(): void {
    const cancelledPath = proposal?.path ?? selectedPath;
    setProposal(null);
    setProposalError(null);
    setApproveError(null);
    onActivity?.(
      `Write proposal cancelled for workspace/${cancelledPath}`,
      "info"
    );
  }

  const breadcrumbs = buildBreadcrumbs(currentPath);
  const isAtRoot = currentPath === "";

  return (
    <div className="flex flex-col h-full overflow-hidden border-t border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0 border-b border-slate-800">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Workspace Files
        </span>
        <div className="flex items-center gap-2">
          {/* Overview toggle — switches between file browser and overview panel */}
          <button
            onClick={() => {
              if (!showOverview) {
                setShowOverview(true);
                // Auto-fetch on first open (or if no data yet)
                if (!overviewData) void fetchOverview();
              } else {
                setShowOverview(false);
              }
            }}
            className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
              showOverview
                ? "bg-cyan-900/30 text-cyan-400 border-cyan-700/40"
                : "text-slate-600 hover:text-slate-400 border-slate-700/40 bg-slate-800/40 hover:border-slate-600/40"
            }`}
            title={showOverview ? "Back to file browser" : "Workspace overview"}
          >
            Overview
          </button>
          {/* Refresh button — reloads the current directory listing (hidden in overview mode) */}
          {!showOverview && (
            <button
              onClick={() => void refreshWorkspace()}
              disabled={listLoading}
              className={`text-slate-600 hover:text-slate-400 transition-colors text-sm leading-none disabled:opacity-40 disabled:cursor-not-allowed ${listLoading ? "animate-spin" : ""}`}
              title="Refresh file list"
              aria-label="Refresh"
            >
              ↻
            </button>
          )}
          <span className="text-xs text-slate-700 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700">
            Read-only
          </span>
        </div>
      </div>

      {/* ── Workspace Overview panel ──────────────────────────────────────────
           Shown instead of the file browser when the user clicks Overview.
           Read-only metadata only — never shows file contents or absolute paths. */}
      {showOverview && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Overview sub-header with reload */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/60 flex-shrink-0">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              Overview
            </span>
            <button
              onClick={() => void fetchOverview()}
              disabled={overviewLoading}
              className={`text-slate-600 hover:text-slate-400 transition-colors text-sm leading-none disabled:opacity-40 ${overviewLoading ? "animate-spin" : ""}`}
              title="Reload overview"
              aria-label="Reload overview"
            >
              ↻
            </button>
          </div>

          {/* Loading */}
          {overviewLoading && !overviewData && (
            <p className="text-xs text-slate-600 px-4 py-3">Scanning workspace…</p>
          )}

          {/* Error */}
          {overviewError && (
            <p className="text-xs text-red-500/70 px-4 py-3">{overviewError}</p>
          )}

          {/* Data */}
          {overviewData && (
            <div className="px-4 py-3 space-y-4 text-xs">

              {/* Totals */}
              <section>
                <p className="font-semibold text-slate-500 uppercase tracking-widest mb-2">
                  Summary
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-800/40 rounded px-3 py-2 border border-slate-700/30">
                    <p className="text-base font-semibold text-slate-200">
                      {overviewData.totalFiles.toLocaleString()}
                    </p>
                    <p className="text-slate-500">files</p>
                  </div>
                  <div className="bg-slate-800/40 rounded px-3 py-2 border border-slate-700/30">
                    <p className="text-base font-semibold text-slate-200">
                      {overviewData.totalDirectories.toLocaleString()}
                    </p>
                    <p className="text-slate-500">folders</p>
                  </div>
                </div>
                {overviewData.capped && (
                  <p className="text-amber-500/60 mt-1.5">
                    Scan capped at{" "}
                    {overviewData.scannedFiles.toLocaleString()} files —
                    some details may be incomplete.
                  </p>
                )}
              </section>

              {/* Project hints */}
              {(overviewData.hints.hasReadme ||
                overviewData.hints.hasPackageJson ||
                overviewData.hints.hasTsConfig ||
                overviewData.hints.hasMakefile) && (
                <section>
                  <p className="font-semibold text-slate-500 uppercase tracking-widest mb-2">
                    Detected
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {overviewData.hints.hasReadme && (
                      <span className="px-1.5 py-0.5 rounded bg-cyan-900/20 text-cyan-500/70 border border-cyan-700/30">
                        README
                      </span>
                    )}
                    {overviewData.hints.hasPackageJson && (
                      <span className="px-1.5 py-0.5 rounded bg-cyan-900/20 text-cyan-500/70 border border-cyan-700/30">
                        package.json
                      </span>
                    )}
                    {overviewData.hints.hasTsConfig && (
                      <span className="px-1.5 py-0.5 rounded bg-cyan-900/20 text-cyan-500/70 border border-cyan-700/30">
                        tsconfig.json
                      </span>
                    )}
                    {overviewData.hints.hasMakefile && (
                      <span className="px-1.5 py-0.5 rounded bg-cyan-900/20 text-cyan-500/70 border border-cyan-700/30">
                        Makefile
                      </span>
                    )}
                  </div>
                </section>
              )}

              {/* File types */}
              {overviewData.extensions.length > 0 && (
                <section>
                  <p className="font-semibold text-slate-500 uppercase tracking-widest mb-2">
                    File types
                  </p>
                  <div className="space-y-1.5">
                    {overviewData.extensions.map(({ ext, count }) => (
                      <div key={ext} className="flex items-center gap-2">
                        <span className="text-slate-400 w-20 flex-shrink-0 font-mono truncate">
                          {ext}
                        </span>
                        <div className="flex-1 h-1 rounded-full bg-slate-700/50 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-cyan-500/40"
                            style={{
                              width: `${Math.round(
                                (count / overviewData.extensions[0].count) * 100
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="text-slate-600 w-7 text-right flex-shrink-0">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Largest files — paths are clickable to open a preview */}
              {overviewData.largestFiles.length > 0 && (
                <section>
                  <p className="font-semibold text-slate-500 uppercase tracking-widest mb-2">
                    Largest files
                  </p>
                  <div className="space-y-1">
                    {overviewData.largestFiles.map(({ path: fp, size }) => (
                      <div
                        key={fp}
                        className="flex items-center justify-between gap-2"
                      >
                        <button
                          onClick={() => handleOverviewFileClick(fp)}
                          className="text-slate-400 truncate font-mono text-left hover:text-cyan-400 transition-colors"
                          title={`Open ${fp}`}
                        >
                          {fp}
                        </button>
                        <span className="text-slate-600 flex-shrink-0">
                          {formatBytes(size)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Recently modified — paths are clickable to open a preview */}
              {overviewData.recentFiles.length > 0 && (
                <section>
                  <p className="font-semibold text-slate-500 uppercase tracking-widest mb-2">
                    Recently modified
                  </p>
                  <div className="space-y-1">
                    {overviewData.recentFiles.map(({ path: fp, modifiedAt }) => (
                      <div
                        key={fp}
                        className="flex items-center justify-between gap-2"
                      >
                        <button
                          onClick={() => handleOverviewFileClick(fp)}
                          className="text-slate-400 truncate font-mono text-left hover:text-cyan-400 transition-colors"
                          title={`Open ${fp}`}
                        >
                          {fp}
                        </button>
                        <span className="text-slate-600 flex-shrink-0 whitespace-nowrap">
                          {new Date(modifiedAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Ask Jarvis about this workspace — pre-fills chat input with
                   structured overview metadata as a prompt.  Nothing is sent
                   automatically; user edits and presses Send.  Disabled until
                   overview data has loaded at least once. */}
              {onAskAboutOverview && (
                <button
                  onClick={() => {
                    if (overviewData) {
                      onAskAboutOverview(generateOverviewPrompt(overviewData));
                    }
                  }}
                  disabled={!overviewData || overviewLoading}
                  className="w-full text-xs py-1.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Ask Jarvis about this workspace
                </button>
              )}

              {/* Read-only safety note */}
              <div className="px-3 py-2 rounded bg-slate-800/60 border border-slate-700/40">
                <p className="text-slate-600">
                  Workspace overview is read-only. It never changes files.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── File browser — hidden while overview is showing ───────────────────
           All existing browsing, search, preview, and write-proposal behaviour
           is completely unchanged. */}
      {!showOverview && (<>

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

      {/* Search input — shown when there is something to search */}
      {!listLoading && !listError && entries.length > 0 && (
        <div className="px-3 py-1.5 border-b border-slate-800/60 flex-shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workspace files…"
              className="flex-1 rounded bg-slate-800/60 border border-slate-700 px-2 py-0.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
            {/* Match count — shown only while a query is active */}
            {searchQuery.trim() && (
              <span className="text-xs text-slate-600 shrink-0 tabular-nums">
                {(() => {
                  const q = searchQuery.trim().toLowerCase();
                  const n = entries.filter(
                    (e) =>
                      e.name.toLowerCase().includes(q) ||
                      e.path.toLowerCase().includes(q)
                  ).length;
                  return n === 0 ? "0" : `${n}`;
                })()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* File / directory listing */}
      <div
        className="overflow-y-auto px-3 py-2 space-y-px"
        style={{ maxHeight: "88px" }}
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
        {!listLoading && (() => {
          const trimmedQuery = searchQuery.trim().toLowerCase();
          const isSearching = trimmedQuery.length > 0;

          // When searching, filter entries by name or path (case-insensitive).
          // Both files and directories are included in the filter so the user
          // can also find and navigate into a matching subdirectory.
          const displayEntries = isSearching
            ? entries.filter(
                (e) =>
                  e.name.toLowerCase().includes(trimmedQuery) ||
                  e.path.toLowerCase().includes(trimmedQuery)
              )
            : entries;

          if (isSearching && displayEntries.length === 0) {
            return (
              <div className="px-1 py-1.5 flex items-center gap-1.5">
                <p className="text-xs text-slate-600 flex-1">
                  No matching workspace files.
                </p>
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-xs text-slate-700 hover:text-cyan-400 transition-colors shrink-0"
                >
                  Clear
                </button>
              </div>
            );
          }

          return displayEntries.map((entry) => {
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
          });
        })()}
      </div>

      {/* File preview — shown when a file is selected */}
      {selectedPath && (
        <div
          className="flex flex-col border-t border-slate-800 flex-shrink-0"
          style={{ maxHeight: proposal ? "260px" : "180px" }}
        >
          {/* Preview header — always visible */}
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

          {proposal ? (
            /* ── Proposal diff view ─────────────────────────────────────── */
            <>
              {/* Warning banner */}
              <div className="flex-shrink-0 px-3 py-2 bg-amber-900/10 border-b border-amber-500/20">
                <p className="text-xs text-amber-400 font-medium">
                  Pending write approval
                </p>
                <p className="text-xs text-amber-700">
                  Nothing has been written yet.
                </p>
              </div>

              {/* Diff lines */}
              <div className="overflow-y-auto flex-1">
                {getDisplayLines(proposal.diff).map((line, i) => {
                  if (line.type === "gap") {
                    return (
                      <div
                        key={i}
                        className="px-3 py-0.5 text-xs text-slate-700 bg-slate-800/40 text-center select-none"
                      >
                        ··· {line.count} unchanged line
                        {line.count !== 1 ? "s" : ""} ···
                      </div>
                    );
                  }
                  const bg =
                    line.type === "added"
                      ? "bg-green-900/30"
                      : line.type === "removed"
                      ? "bg-red-900/30"
                      : "";
                  const text =
                    line.type === "added"
                      ? "text-green-300"
                      : line.type === "removed"
                      ? "text-red-300"
                      : "text-slate-600";
                  const prefix =
                    line.type === "added"
                      ? "+"
                      : line.type === "removed"
                      ? "-"
                      : " ";
                  return (
                    <div
                      key={i}
                      className={`flex gap-2 px-3 py-px font-mono text-xs leading-relaxed ${bg} ${text}`}
                    >
                      <span className="flex-shrink-0 select-none w-2.5">
                        {prefix}
                      </span>
                      <span className="whitespace-pre-wrap break-all">
                        {line.content}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Approve / Cancel buttons */}
              <div className="flex-shrink-0 px-3 py-2 border-t border-slate-800/60 space-y-1.5">
                {approveError && (
                  <p className="text-xs text-red-500/70 text-center">
                    {approveError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleApprove()}
                    disabled={approveLoading}
                    className="flex-1 text-xs py-1.5 rounded bg-green-900/20 text-green-400 border border-green-500/20 hover:bg-green-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {approveLoading ? "Writing…" : "Approve write"}
                  </button>
                  <button
                    onClick={handleCancelProposal}
                    disabled={approveLoading}
                    className="flex-1 text-xs py-1.5 rounded bg-slate-700/40 text-slate-400 border border-slate-600/30 hover:bg-slate-700/60 hover:text-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* ── Normal file preview ─────────────────────────────────────── */
            <>
              {/* File content */}
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

              {/* Action buttons */}
              {fileContent !== null && (
                <div className="flex-shrink-0 px-3 py-2 border-t border-slate-800/60 space-y-1.5">
                  {writeSuccess ? (
                    <p className="text-xs text-green-500 text-center">
                      ✓ File written successfully.
                    </p>
                  ) : proposalLoading ? (
                    <p className="text-xs text-slate-600 text-center">
                      Creating proposal…
                    </p>
                  ) : proposalError ? (
                    <>
                      <p className="text-xs text-red-500/70 text-center">
                        {proposalError}
                      </p>
                      <button
                        onClick={() => void handleProposeEdit()}
                        className="w-full text-xs py-1.5 rounded bg-amber-900/20 text-amber-500 border border-amber-500/20 hover:bg-amber-900/30 hover:text-amber-400 transition-colors"
                      >
                        Retry propose
                      </button>
                    </>
                  ) : asked ? (
                    <p className="text-xs text-cyan-600 text-center">
                      ✓ Queued — edit the question and press Send.
                    </p>
                  ) : attached ? (
                    <p className="text-xs text-cyan-600 text-center">
                      ✓ Attached — will be included in your next message
                    </p>
                  ) : (
                    <>
                      {onAskAboutFile && (
                        <button
                          onClick={handleAsk}
                          className="w-full text-xs py-1.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors"
                        >
                          Ask Jarvis about this file
                        </button>
                      )}
                      {onAttachFile && (
                        <button
                          onClick={handleAttach}
                          className="w-full text-xs py-1.5 rounded bg-slate-700/40 text-slate-400 border border-slate-600/30 hover:bg-slate-700/60 hover:text-slate-200 transition-colors"
                        >
                          Attach to chat
                        </button>
                      )}
                      <button
                        onClick={() => void handleProposeEdit()}
                        className="w-full text-xs py-1.5 rounded bg-amber-900/20 text-amber-500 border border-amber-500/20 hover:bg-amber-900/30 hover:text-amber-400 transition-colors"
                      >
                        Propose safe edit
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
      </>)}
    </div>
  );
}

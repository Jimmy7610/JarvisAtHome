# Decision 080 — Workspace Intelligence Foundation (v1.4.0)

**Date:** 2026-05-02
**Status:** Accepted and implemented

## Context

v1.3.x completed the agent plan feature set.  v1.4.0 starts a new track:
"workspace intelligence" — giving the user a better understanding of what lives
in their workspace without leaving the Jarvis UI.  The foundation is a read-only
overview panel that shows high-level metadata about the workspace tree.

## Design goals

- **Read-only** — the overview endpoint never reads file contents, never writes,
  never deletes.
- **No absolute paths** — all paths returned are workspace-relative (`path.relative`
  from the workspace root).
- **On-demand** — the overview is fetched when the user opens it, not on every
  page load.
- **Capped scan** — the recursive walk stops at 2000 files to keep response time
  fast even on large workspaces.
- **Non-disruptive** — the existing file browser, write-approval flow, and all
  other workspace features are completely unchanged.

## Backend: `GET /files/overview`

### Service function (`fileTools.ts`)

`scanWorkspaceOverview()` recursively walks the workspace using `fs.readdirSync`
and `fs.statSync`.  It:

1. Skips hidden files/directories (names starting with `.`)
2. Skips `SKIP_DIRS` (same set as `listFiles`: `node_modules`, `.git`, `.next`,
   `dist`, `build`, `data`, `.turbo`, `coverage`, `out`)
3. Stops processing new files once `scannedFiles > OVERVIEW_MAX_FILES` (2000)
4. Collects per-file: workspace-relative path, size (bytes), mtime
5. Tracks extension counts in a `Map<string, number>`
6. Checks project-file hints by filename (case-insensitive)

### Response shape

```typescript
{
  ok: true,
  totalFiles: number,
  totalDirectories: number,
  scannedFiles: number,         // how many files were processed
  capped: boolean,              // true if scan stopped early
  extensions: Array<{ ext: string; count: number }>,  // top 15
  largestFiles: Array<{ path: string; size: number }>,  // top 10
  recentFiles: Array<{ path: string; size: number; modifiedAt: string }>,  // top 10
  hints: {
    hasReadme: boolean,
    hasPackageJson: boolean,
    hasTsConfig: boolean,
    hasMakefile: boolean,
  }
}
```

No file content is ever included.

### Route

`router.get("/overview", ...)` — plain handler, no auth needed (same policy as
the rest of the files routes which are local-only).

## Frontend: WorkspacePanel overview mode

### State

```typescript
const [showOverview, setShowOverview] = useState(false);
const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
const [overviewLoading, setOverviewLoading] = useState(false);
const [overviewError, setOverviewError] = useState<string | null>(null);
```

### Toggle button

An "Overview" pill button in the panel header toggles between file browser and
overview.  On first open, `fetchOverview()` is called automatically.

### File browser isolation

The existing breadcrumb + search + file listing + file preview JSX is wrapped in
`{!showOverview && (<> ... </>)}`.  The overview panel is `{showOverview && (...)}`.
No existing JSX was modified — only wrapped.

### Overview panel sections

1. **Summary** — file / folder count grid
2. **Detected** — project-file hint pills (only when at least one is found)
3. **File types** — mini bar chart (relative to max count in the set)
4. **Largest files** — path + size
5. **Recently modified** — path + date
6. **Safety note** — "Workspace overview is read-only. It never changes files."

## Safety contract

- `scanWorkspaceOverview` never calls `readTextFile` or any write function.
- `resolveWorkspacePath` is NOT called during the scan (paths are built via
  `path.relative` after a trusted recursive walk from the workspace root — no
  user-supplied path is involved).
- Absolute paths never appear in the response.
- The endpoint reads only `fs.statSync` metadata — no file buffers.
- Backend unchanged in all other respects.

## Files changed

| File | Change |
|---|---|
| `apps/api/src/services/fileTools.ts` | `WorkspaceOverview` type + `scanWorkspaceOverview()` function |
| `apps/api/src/routes/files.ts` | `GET /files/overview` route; import `scanWorkspaceOverview` |
| `apps/web/src/components/WorkspacePanel.tsx` | `OverviewData` / `OverviewResponse` types; overview state; `fetchOverview()`; Overview toggle button in header; overview panel JSX; file browser wrapped in `{!showOverview && ...}` |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.4.0"` |
| `apps/web/src/app/page.tsx` | Sidebar footer → `v1.4.0 — workspace intelligence foundation` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.4.0"`; Feature Status row; Safety card row |
| `README.md` | Heading → v1.4.0; feature bullet |
| `docs/decisions/080-workspace-intelligence-foundation.md` | This document |

## What is NOT changed

- All existing WorkspacePanel features (browse, search, attach, ask, propose edit)
- All write-proposal flows
- Chat, agent plans, project library, memory, settings
- JarvisBrain — untouched

## Next steps

- Deep-link: clicking a file in the overview panel navigates to and previews it.
- Workspace summary card in Settings.
- Auto-refresh overview on file write approval.

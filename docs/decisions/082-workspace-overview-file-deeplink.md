# Decision 082 — Workspace Overview File Deep-link (v1.4.2)

**Date:** 2026-05-02
**Status:** Accepted and implemented

## Context

v1.4.0 added the read-only workspace overview panel (file counts, extension chart,
largest/recent files, project hints).  The file paths in "Largest files" and
"Recently modified" were plain text — the user could see them but not act on them.
v1.4.2 makes those paths clickable so the user can jump directly to the file
preview without having to browse manually.

## Design goals

- **Zero new props** — the deep-link logic is entirely inside `WorkspacePanel`
  and reuses the existing `navigateTo`, `fetchList`, `handleSelectFile`, and
  `pendingOpenFileRef` machinery.
- **Consistent navigation** — the click behaves identically to selecting a file
  from the normal file listing: folder navigation, pending-open queue, preview.
- **Read-only** — clicking a path never writes, modifies, or deletes anything.
- **Activity event** — `Workspace overview file opened: <path>` logged.
- **No absolute paths** — the workspace-relative paths returned by the overview
  endpoint are used directly; no path construction occurs in the frontend.

## Implementation

### `handleOverviewFileClick(filePath: string): void`

New function inside `WorkspacePanel`, placed in the "Overview file deep-link"
section:

1. Calls `setShowOverview(false)` — returns to the file browser view.
2. Extracts the parent directory from the path with `lastIndexOf("/")`.
3. Emits `onActivity?.("Workspace overview file opened: <path>", "info")`.
4. Sets `pendingOpenFileRef.current = filePath`.
5. If `currentPath !== parentDir` → calls `navigateTo(parentDir)`.  The listing
   `useEffect` watches `currentPath`, fires `fetchList`, then reads
   `pendingOpenFileRef` and auto-selects the file after loading.
6. If already in the right folder → mirrors the `openFileRequest` handler:
   refreshes the listing manually via `fetchList`, then calls `handleSelectFile`
   if the file is found.

### JSX changes

In both the "Largest files" and "Recently modified" sections, the file path
`<span>` is replaced with a `<button>` that:
- Has `onClick={() => handleOverviewFileClick(fp)}`
- Uses `text-slate-400 hover:text-cyan-400 transition-colors` for a subtle but
  discoverable affordance
- Retains `truncate font-mono text-left` so long paths behave the same as before
- Has `title={`Open ${fp}`}` for accessibility / tooltip

The size / date metadata spans are unchanged.

## Safety contract

- `handleOverviewFileClick` calls only existing read-path functions:
  `navigateTo` → `fetchList` → `handleSelectFile` → `GET /files/read`.
- No write, no modify, no delete.
- The path passed to `handleSelectFile` and ultimately to `GET /files/read?path=`
  is the workspace-relative string from the overview response — it was validated
  by the backend scan and goes through the same `resolveWorkspacePath` guard as
  any other file read.
- `setShowOverview(false)` only toggles UI state.
- `pendingOpenFileRef` is already used by `openFileRequest` — no new state.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/WorkspacePanel.tsx` | `handleOverviewFileClick()`; "Largest files" and "Recently modified" rows → clickable buttons |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.4.2"` |
| `apps/web/src/app/page.tsx` | Sidebar footer → `v1.4.2 — workspace overview file deep-link` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.4.2"`; Feature Status row |
| `README.md` | Heading → v1.4.2; feature bullet |
| `docs/decisions/082-workspace-overview-file-deeplink.md` | This document |

## What is NOT changed

- All other workspace overview behaviour (load, reload, ask helper, summary, hints, extension chart)
- All file browser behaviour (browse, search, attach, ask, propose edit)
- All write-proposal flows
- Chat, agent plans, project library, memory, settings
- JarvisBrain — untouched

## Next steps

- Workspace summary card in Settings showing a live overview widget.
- Auto-refresh overview on file write approval.
- Deep-link from the extension chart (click a type to filter the file browser).

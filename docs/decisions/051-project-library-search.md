# Decision 051 - Project Library Search (v0.7.3)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.7.0 introduced recursive file listing for Project Library projects.
A project with many files (source code, documentation, scripts) is hard to
navigate by scrolling alone.  v0.7.3 adds a lightweight frontend filter so
the user can type a few characters and immediately see matching files.

## Why frontend-only filtering

The backend `GET /projects/:name` route already returns the full recursive
file list (up to 500 entries).  All data needed for search is already present
in the component's `files` state.  A backend round-trip for every keystroke
would add latency and server load for no benefit.

## Filter logic

```typescript
const filteredFiles = isSearching
  ? files.filter(
      (e) =>
        e.type === "file" &&
        (e.path.toLowerCase().includes(trimmedQuery) ||
          e.name.toLowerCase().includes(trimmedQuery))
    )
  : files; // full list when query is empty
```

- Case-insensitive substring match on both the full relative path and the file name.
- Directory header entries are excluded from search results — they are only
  meaningful as structural hints in the full tree view.  When searching, a flat
  list of matching files is cleaner than a mix of orphaned directory headers.
- The full tree (including directory headers) is restored when the search is cleared.

## State management

One new piece of state: `searchQuery: string`, initialised to `""`.

The query is reset to `""` in:
- `handleOpenPanel()` — when the library is first opened.
- `handleSelectProject()` — when switching to a different project.
- `handleBackToProjects()` — when navigating back to the project list.

This prevents stale search state leaking between projects.

## UI decisions

- The search input is placed inside `renderFileList()`, above the file list,
  as a narrow single-line text field.  It only appears when a project has at
  least one file entry.
- Match count (`N matches` / `1 match`) is shown below the input while a
  query is active.
- Zero-result state shows a magnifying glass icon, "No matching files.", and
  a "Clear search" button.
- No Activity Log event is emitted for search — it would spam one event per
  keystroke.

## Preserved behaviours

- Clicking a filtered file row calls the same `handleSelectFile()` path as
  before — file preview, Attach, and Ask Jarvis all work identically.
- The normal tree view (with directory headers) is fully restored when the
  search is cleared.
- No write paths, no proposals, no backend changes.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ProjectLibraryPanel.tsx` | Added `searchQuery` state; clear on navigation; added search input + filtered list in `renderFileList()` |
| `docs/decisions/051-project-library-search.md` | This document |
| `README.md` | Version bumped to v0.7.3, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| Backend `/projects` routes | Unchanged |
| ChatPanel | Unchanged |
| page.tsx | Unchanged |
| WorkspacePanel | Unchanged |
| Write-with-approval flow | Unchanged |
| TTS system | Unchanged |
| Project Library read-only guarantee | Unchanged |

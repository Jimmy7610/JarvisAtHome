# Decision 052 - Workspace Files Search (v0.7.4)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.7.3 added search to the Project Library.  The Workspace Files panel has the
same browsing pattern (click to navigate, click to preview) but no filter.
v0.7.4 mirrors the search feature into WorkspacePanel for consistency.

## Why current-directory only (not recursive)

WorkspacePanel loads one directory at a time via `GET /files/list?path=...`.
The `entries` state contains only the **direct children** of the currently
browsed directory.  WorkspacePanel was deliberately designed as a directory
navigator rather than a flat recursive tree.

A recursive search would require:
- A new backend endpoint (`GET /files/search?q=...`) or a full-tree fetch.
- Additional frontend state management.
- Significantly more complexity for a narrow use case.

The smallest safe implementation — filter the already-loaded `entries` — covers
the common case (find a file whose name you partially remember in the current
folder) without any of that complexity.

If the workspace grows to a size where cross-directory search is needed,
a dedicated backend search route can be added in a future milestone.

## Scope of filtering

Both file and directory entries are included in the filtered results.  A
directory match (e.g., typing "draft" matches "drafts/") is still navigable:
clicking the result calls the same `navigateTo()` handler as normal.

The filter matches against:
- `entry.name` — the bare file or folder name
- `entry.path` — the relative path from workspace root (usually identical to
  name in the current directory, but keeps the logic consistent with the
  Project Library filter)

## State management

One new piece of state: `searchQuery: string`, initialised to `""`.

The query is reset to `""` inside `navigateTo()` — the single function all
navigation paths pass through (breadcrumb clicks, up button, folder clicks,
and the `openFileRequest` effect).  This guarantees stale search never leaks
into a different directory.

## UI decisions

- The search input is placed as a new row between the breadcrumb and the
  file listing.
- It is only rendered when `!listLoading && !listError && entries.length > 0`
  so it does not appear on empty folders or during loading.
- A running match count (numeric only, beside the input) updates as the user
  types.
- The listing `maxHeight` was reduced from `120px` to `88px` to absorb the
  new input row without the total panel height growing.
- Zero-result state shows "No matching workspace files." with a "Clear" link
  inline — consistent with the compact layout.
- No Activity Log event emitted per keystroke.

## Preserved behaviours

- Clicking a directory in filtered results navigates as normal and clears the
  search (via `navigateTo()`).
- Clicking a file in filtered results opens the preview as normal — Attach,
  Ask Jarvis, Propose safe edit, Approve, and Cancel all work identically.
- The existing write approval flow is not touched.
- Refresh does not clear the search (the user may want to refresh and continue
  filtering the same directory).

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/WorkspacePanel.tsx` | Added `searchQuery` state; clear in `navigateTo()`; added search input + filtered listing; `maxHeight` 120 → 88px |
| `docs/decisions/052-workspace-files-search.md` | This document |
| `README.md` | Version bumped to v0.7.4, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| Backend file routes | Unchanged |
| Write-with-approval flow | Unchanged |
| ChatPanel | Unchanged |
| page.tsx | Unchanged |
| Project Library | Unchanged |
| TTS system | Unchanged |

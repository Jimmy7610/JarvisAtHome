# Decision 083 — Workspace Overview Auto-refresh After Approved Writes (v1.4.3)

**Date:** 2026-05-02
**Status:** Accepted and implemented

## Context

v1.4.0 added the read-only Workspace Overview (file counts, extension chart,
largest/recent files, project hints).  Until v1.4.3, the overview cached its
data until the user manually clicked the ↻ reload button.  An approved write
(creating or updating a workspace file) could silently make the overview stale —
the file would not appear in "Recently modified", and size counts could be wrong.

## Design goals

- **Immediate refresh when visible** — if the overview panel is open at the
  moment a write is approved, re-fetch automatically so the user sees fresh data
  without a manual reload.
- **Stale-on-close** — if the overview is not visible, clear the cached
  `overviewData` state (`null`) so the next toggle-open auto-fetches (the toggle
  button already calls `fetchOverview()` when `overviewData` is null).
- **Cancel/failure does nothing** — only a successful `data.ok === true` response
  from the backend triggers invalidation.
- **No new state, no new props, no new backend endpoints** — all logic is
  confined to WorkspacePanel, using existing state (`showOverview`,
  `overviewData`, `fetchOverview`, `setOverviewData`).
- **One activity event, only when visible** — to avoid log noise when the
  overview is not even open.

## Where approvals happen

There are two places in the frontend where an approved write can succeed:

### 1. `WorkspacePanel.handleApprove()` (WorkspacePanel's own approval)

The user clicks "Propose safe edit" directly in the Workspace Files browser, then
clicks "Approve write".  `handleApprove()` is already in WorkspacePanel scope
and has direct access to `showOverview`, `fetchOverview`, and `setOverviewData`.

**Change:** after `void fetchList(currentPath)` in the success path:
```typescript
if (showOverview) {
  void fetchOverview();
  onActivity?.("Workspace overview refreshed after approved write", "info");
} else {
  setOverviewData(null);
}
```

### 2. `ChatPanel` approval → `openFileRequest` useEffect (ChatPanel-originated approvals)

The user approves a `jarvis-write-proposal` emitted in the chat.  ChatPanel calls
`props.onOpenWorkspaceFile?.(relativePath)` on success; `page.tsx` turns that
into the `openFileRequest` prop on WorkspacePanel.  WorkspacePanel already
watches `openFileRequest` in a `useEffect` to navigate the file browser.

`openFileRequest` being non-null is a reliable signal that a write just succeeded
(it is only ever set by `handleOpenWorkspaceFile` in `page.tsx`, which is only
ever called by `onOpenWorkspaceFile` in ChatPanel, which is only ever called
after a successful `POST /files/approve-write`).

**Change:** at the top of the `openFileRequest` useEffect body (after
`onOpenFileRequestConsumed?.()`):
```typescript
if (showOverview) {
  void fetchOverview();
  onActivity?.("Workspace overview refreshed after approved write", "info");
} else {
  setOverviewData(null);
}
```

The `eslint-disable-line react-hooks/exhaustive-deps` comment already suppresses
the exhaustive-deps warning for this effect — `showOverview`, `fetchOverview`,
and `setOverviewData` captured by closure are correct at the time the effect fires
(a new write approval always results in a fresh render before the effect runs).

## Behaviour table

| Situation | Outcome |
|---|---|
| Write approved, overview **visible** | `fetchOverview()` called → data refreshes; activity event logged |
| Write approved, overview **hidden** | `setOverviewData(null)` → next open auto-fetches; no activity event |
| Write **cancelled** | Nothing changes |
| Write approval **fails** | Nothing changes (path is in the `catch` branch, not the success path) |

## Safety contract

- No file is read or written by the invalidation logic.
- `fetchOverview()` calls `GET /files/overview` which is already read-only and
  capped at 2000 files with no content access.
- `setOverviewData(null)` only clears cached UI state.
- No autonomous writes are introduced.
- Write approval still requires explicit user action.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/WorkspacePanel.tsx` | Overview invalidation in `handleApprove` success path; overview invalidation at top of `openFileRequest` useEffect |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.4.3"` |
| `apps/web/src/app/page.tsx` | Sidebar footer → `v1.4.3 — overview auto-refresh after writes` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.4.3"`; Feature Status row |
| `README.md` | Heading → v1.4.3; feature bullet |
| `docs/decisions/083-workspace-overview-refresh-after-write.md` | This document |

## What is NOT changed

- All other WorkspacePanel behaviour (browse, search, attach, ask, propose, approve, cancel)
- All overview behaviour (load, reload, ask helper, file deep-links, extension chart)
- ChatPanel, page.tsx (no new props or state)
- All other write-proposal flows
- JarvisBrain — untouched

## Next steps

- Workspace summary card in Settings (live read-only overview widget alongside safety card).
- Auto-refresh overview after Project Library write approvals (if those are added).

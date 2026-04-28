# Decision 034 — Open Created Draft from Success State (v0.4.1)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

After approving a new local email draft through the chat write-approval flow, the
success banner only showed a generic "File written successfully" message.  The user
had no quick way to verify the content of the newly created file without manually
navigating the Workspace Files panel themselves.

## Goal

After approving a draft write (path starts with `drafts/`), show:
- The created path: `Draft created: workspace/drafts/<filename>.md`
- An **"Open draft in Workspace Files"** button that navigates the panel to the
  `drafts/` folder and auto-previews the file

For non-draft writes, the existing success message is unchanged.

## Design

The three components involved pass information through parent-level state rather than
global state or a routing change:

```
ChatPanel
  └─ onOpenWorkspaceFile(path) ──► page.tsx
                                     └─ openFileRequest state ──► WorkspacePanel
```

**No new backend endpoints, no URL changes, no router dependency.**

## Changes

### `apps/web/src/components/ChatPanel.tsx`

- Added `onOpenWorkspaceFile?: (relativePath: string) => void` prop (destructured and
  typed).
- Added `chatApprovedPath: string | null` state — stores the relative path of the
  most recently approved write so it remains accessible after `chatProposal` is
  cleared.
- `handleChatApprove`: captures `chatProposal.path` into `approvedPath` before
  clearing `chatProposal`; stores it with `setChatApprovedPath(approvedPath)`.
- Success banner:
  - When `chatApprovedPath` starts with `drafts/`: shows the full path label and
    an **"Open draft in Workspace Files"** button that calls
    `onOpenWorkspaceFile(chatApprovedPath)`.
  - Otherwise: unchanged "File written successfully" message.
- `send()` and the dismiss × button both reset `chatApprovedPath` to `null`.

### `apps/web/src/app/page.tsx`

- Added `openFileRequest: string | null` state (initialized `null`).
- Added `handleOpenWorkspaceFile(relativePath)` function that sets
  `openFileRequest`.
- Passes `onOpenWorkspaceFile={handleOpenWorkspaceFile}` to `ChatPanel`.
- Passes `openFileRequest` and `onOpenFileRequestConsumed={() => setOpenFileRequest(null)}`
  to `WorkspacePanel`.

### `apps/web/src/components/WorkspacePanel.tsx`

- Added `useRef` import.
- Added two new props:
  - `openFileRequest?: string | null` — the file path to navigate to and preview.
  - `onOpenFileRequestConsumed?: () => void` — called immediately so the parent
    resets `openFileRequest` to `null` (prevents infinite effect loops).
- Added `pendingOpenFileRef = useRef<string | null>(null)` — stores the target path
  without triggering a re-render.
- **Main listing `useEffect`** (fires when `currentPath` changes) updated to an
  `async` inner function `loadAndMaybeOpen()` that:
  1. Awaits `fetchList(currentPath)`.
  2. Checks `pendingOpenFileRef.current`; if set and the file appears in the new
     entries, calls `handleSelectFile(pending)` and clears the ref.
- New **`openFileRequest` `useEffect`** that fires when the prop changes:
  1. Calls `onOpenFileRequestConsumed?.()` immediately.
  2. Computes `parentDir` from the path's last `/`.
  3. Sets `pendingOpenFileRef.current = openFileRequest`.
  4. If `currentPath !== parentDir` → calls `navigateTo(parentDir)`.  The listing
     `useEffect` will fire and pick up the pending file.
  5. If `currentPath === parentDir` → the listing `useEffect` won't re-fire, so it
     calls `fetchList` + selects the file directly (the newly created file may not
     be in the cached listing).

## Flow (worked example)

1. User approves `drafts/cleaning-day-board.md` in chat.
2. `handleChatApprove` stores `approvedPath = "drafts/cleaning-day-board.md"`.
3. Success banner shows path + "Open draft in Workspace Files" button.
4. User clicks the button → `onOpenWorkspaceFile("drafts/cleaning-day-board.md")` called.
5. `page.tsx` sets `openFileRequest = "drafts/cleaning-day-board.md"`.
6. `WorkspacePanel` `openFileRequest` effect fires:
   - Calls `onOpenFileRequestConsumed()` → parent resets to `null`.
   - `parentDir = "drafts"`.
   - If at root: `navigateTo("drafts")` → `currentPath = "drafts"`.
   - Listing `useEffect` fires → `fetchList("drafts")` → entries include the new file.
   - `pendingOpenFileRef.current` found → `handleSelectFile("drafts/cleaning-day-board.md")`.
7. Draft is previewed in Workspace Files. ✓

## What is NOT changed

| Property | Status |
|---|---|
| Write-with-approval flow | Unchanged |
| Cancel behavior | Unchanged |
| Non-draft success state | Unchanged ("File written successfully.") |
| Existing Workspace Files navigation, attach, ask, refresh | Unchanged |
| Activity Log | Unchanged |
| Backend | Unchanged |
| Email sending, SMTP, OAuth | Not added — never will be |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `onOpenWorkspaceFile` prop; `chatApprovedPath` state; draft success UI |
| `apps/web/src/app/page.tsx` | `openFileRequest` state; `handleOpenWorkspaceFile`; props wired |
| `apps/web/src/components/WorkspacePanel.tsx` | `openFileRequest` + `onOpenFileRequestConsumed` props; `pendingOpenFileRef`; listing effect and open-file effect |
| `docs/decisions/034-open-created-draft.md` | This document |
| `README.md` | Short note added |

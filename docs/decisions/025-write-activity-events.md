# Decision 025 — Write Activity Events in ActivityPanel (v0.3.1)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

v0.3.0 introduced the write-with-approval flow but logged write events only to `console.log`. The ActivityPanel already existed with support for `"write"` and `"error"` event types (styled in amber and red respectively). Wiring those together closes the gap so users can see write activity inline.

## What changed

No backend changes. Frontend-only.

### `apps/web/src/components/WorkspacePanel.tsx`

Added `onActivity` prop (already present from the v0.3.0 branch, now fully wired):

| User action | ActivityPanel event | Type |
|---|---|---|
| Propose safe edit — success | `Write proposal created for workspace/<path>` | `"write"` |
| Propose safe edit — failure | `Write proposal failed for <path>: <error>` | `"error"` |
| Approve write — success | `Write approved and applied to workspace/<path>` | `"write"` |
| Approve write — failure | `Write approval failed for <path>: <error>` | `"error"` |
| Cancel proposal | `Write proposal cancelled for workspace/<path>` | `"info"` |

### `apps/web/src/app/page.tsx`

`onActivity={handleActivity}` passed to `WorkspacePanel`. Already done in v0.3.1 setup.

## Design notes

- Frontend-only: no new API routes or backend changes needed.
- Uses the existing `onActivity?(text, type?)` callback pattern — same as other panel-to-parent communication in this project.
- `handleCancelProposal` captures `proposal?.path` before clearing state so the event message still names the correct file.
- The `"write"` type was already defined in `ActivityEvent` and styled in `ActivityPanel` — no new types needed.

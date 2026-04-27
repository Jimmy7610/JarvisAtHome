# Decision 028 — Write Approval UI Polish (v0.3.4)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

v0.3.3 landed the write-with-approval flow in chat (chat-created proposals, amber callout, diff panel, Approve/Cancel buttons). Two small usability gaps remained:

1. The diff viewer was hard to scan — no clear visual separation between added, removed, and context lines beyond colour alone.
2. Cancelling a write proposal logged an `"info"` event (plain slate), making it visually indistinguishable from generic status events.

## Changes

### A — Diff panel readability

**Problem:** A flat list of lines with only background colour to distinguish types made added/removed/context lines hard to scan at a glance. The 160 px max-height was tight for multi-line diffs. Context lines (`text-slate-600`) were too dark to read.

**Solution:**

- Restructured the diff container into two parts:
  - **Header row** (fixed, not scrollable): shows `diff  workspace/<path>` in amber monospace — makes the target file immediately obvious without scanning the text above.
  - **Scrollable body**: `maxHeight: 190px` (was 160 px), so more lines are visible before scrolling.
- Each diff line now carries a **2 px left border accent** for instant visual scanning:
  - Added lines: `border-green-600` + `bg-green-900/25` + `text-green-300`
  - Removed lines: `border-red-700` + `bg-red-900/20` + `text-red-300`
  - Context lines: `border-transparent` (same 2 px width so content never shifts) + `text-slate-400` (was `text-slate-600` — now readable)
  - Gap rows: same transparent border for alignment
- Prefix column widened from `w-2.5` to `w-3`; removed lines now show `−` (U+2212, typographic minus) instead of `-`.
- Horizontal padding changed from `px-3` to `pl-2 pr-3` so the border accent sits flush against the left edge of the container.

No existing safety logic was changed. The diff is still computed and stored by the backend; this is purely display.

### B — Cancel activity event type

**Problem:** `handleChatCancelProposal` emitted an `"info"` event. In ActivityPanel, `"info"` events have no badge and use the default slate style — they blend in with unrelated status messages.

**Solution:** Changed the event type from `"info"` to `"write"` so the cancellation event receives the same amber card and "write" badge as other proposal/approval events. This makes the full write-proposal lifecycle (detected → created → cancelled/approved) consistently amber in the Activity Log.

No new ActivityPanel event types were added. No backend changes.

## Safety notes

- No write safety rules changed.
- No new write capability added.
- Approve/Cancel buttons and `detectAndPropose` flow are unchanged.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | Diff viewer restructured (header + scrollable body, border accents, readable colours); cancel event type `"info"` → `"write"` |
| `docs/decisions/028-write-approval-ui-polish.md` | This document |
| `README.md` | Short v0.3.4 note added |

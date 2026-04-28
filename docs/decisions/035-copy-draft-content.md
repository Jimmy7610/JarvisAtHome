# Decision 035 — Copy Draft Content to Clipboard (v0.4.2)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.4.1 added an "Open draft in Workspace Files" button to the chat success state
after a draft is approved.  To paste the draft into a real email client the user
still had to open the Workspace preview, select all text, and copy manually.

A "Copy draft content" button that writes the approved text directly to the clipboard
makes this faster without adding any email-sending capability.

## Design

The approved content was already available inside `ChatPanel` at proposal-creation
time (parsed from the assistant response in `detectAndPropose`).  It just was not
stored past the `setChatProposal` call.

The fix is minimal:
1. Add `content: string` to the `chatProposal` state shape so it travels with the
   proposal until approval.
2. At approval time, snapshot it into a new `chatApprovedContent` state — exactly
   the same pattern used for `chatApprovedPath`.
3. Add a `handleCopyDraft` function that calls `navigator.clipboard.writeText`.
4. Render the button in the draft success banner.

No backend reads, no new API calls, no page navigation.

## Changes

### `apps/web/src/components/ChatPanel.tsx`

**`chatProposal` state type** — added `content: string` field.

**`detectAndPropose`** — `setChatProposal` now includes `content: proposalContent`
(the string that was already validated and sent to the backend).

**New state variables:**
- `chatApprovedContent: string | null` — the full Markdown text of the approved draft.
- `chatCopied: boolean` — true for 2 seconds after a successful clipboard write;
  drives the "✓ Copied to clipboard" label.
- `chatCopyError: string | null` — set when `navigator.clipboard.writeText` throws;
  shown inline without hiding the rest of the success banner.

**`handleChatApprove`** — before clearing `chatProposal`, captures
`chatProposal.content` into `approvedContent` and stores it with
`setChatApprovedContent`.  Also resets `chatCopied` and `chatCopyError` so the
copy button always starts in the default state for each new approval.

**New function `handleCopyDraft`** — async, calls
`navigator.clipboard.writeText(chatApprovedContent)`:
- On success: sets `chatCopied = true`, emits an `"info"` Activity Log event,
  schedules `setChatCopied(false)` after 2 000 ms.
- On failure: sets `chatCopyError` with a hint to open the draft manually.
  The banner remains visible; the error message replaces the button.

**Success banner** (draft path only) — button order:
1. "Open draft in Workspace Files" (cyan, unchanged from v0.4.1)
2. "Copy draft content" (slate) → replaced by "✓ Copied" label on success or
   an inline error on failure.

**`send()` and dismiss × button** — reset `chatApprovedContent`, `chatCopied`,
`chatCopyError` alongside the existing state resets.

## What is NOT changed

| Property | Status |
|---|---|
| Write-with-approval flow | Unchanged |
| "Open draft in Workspace Files" button | Unchanged |
| Non-draft success state | Unchanged |
| Cancel behavior | Unchanged |
| Activity Log | Unchanged (minor info event added on copy) |
| Backend | Unchanged |
| WorkspacePanel | Unchanged |
| page.tsx | Unchanged |
| Email sending / SMTP / OAuth | Not added |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `content` in proposal state; `chatApprovedContent`, `chatCopied`, `chatCopyError` states; `handleCopyDraft`; updated success banner |
| `docs/decisions/035-copy-draft-content.md` | This document |
| `README.md` | Short note added |

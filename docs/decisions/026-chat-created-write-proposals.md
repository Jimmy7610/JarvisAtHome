# Decision 026 — Chat-Created Write Proposals (v0.3.2)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

v0.3.0 introduced the write-with-approval foundation (manual propose → approve flow in WorkspacePanel). v0.3.2 extends this so the chat/Ollama response can _propose_ a workspace file edit — but the same two-step approve flow is required. Nothing is written automatically. Ollama cannot call `approve-write`.

## How it works

When the assistant response contains a fenced block in this exact format:

````
```jarvis-write-proposal
{
  "path": "drafts/example.md",
  "content": "# New content\n\nThis replaces the file."
}
```
````

ChatPanel detects the block after streaming ends, parses the JSON, and calls the existing `POST /files/propose-write` backend endpoint. The resulting diff is shown in an amber "Pending write approval" banner above the chat input. The user then either clicks **Approve write** (calls `POST /files/approve-write`) or **Cancel**.

The raw fenced block remains visible in the assistant message for transparency.

## Safety properties

| Property | How it is enforced |
|---|---|
| No automatic writes | `approve-write` is only called when the user clicks "Approve write" |
| Workspace sandbox | `resolveWorkspacePath()` is called on both propose and approve (unchanged from v0.3.0) |
| Only existing files | `proposeWrite` requires the target file to already exist (unchanged from v0.3.0) |
| One proposal at a time | Sending a new message resets any previous chat proposal state |
| JSON parse failure handled | Shown as error in the banner; no proposal is created |
| Missing fields handled | Shown as error in the banner; no proposal is created |
| API unreachable handled | Shown as error in the banner |

## What was implemented

### `apps/web/src/components/ChatPanel.tsx`

- Added `DiffLine`, `DisplayLine`, `getDisplayLines` types and function (mirrors WorkspacePanel — no shared component extracted to avoid premature abstraction)
- Added `WRITE_PROPOSAL_REGEX` to detect fenced blocks
- Added `onActivity` prop
- Added chat proposal state: `chatProposal`, `chatProposalLoading`, `chatProposalError`, `chatApproveLoading`, `chatApproveError`, `chatWriteSuccess`
- Added `detectAndPropose(text)` — called after stream completes; scans `assistantText`, calls `POST /files/propose-write`
- Added `handleChatApprove()` — calls `POST /files/approve-write`
- Added `handleChatCancelProposal()` — clears proposal state, emits activity event
- `send()` resets proposal state at the start of each new message
- `send()` calls `detectAndPropose(assistantText)` after stream ends successfully
- "Pending write approval" banner rendered between message list and input bar (amber styling, diff viewer, Approve/Cancel buttons, dismiss button on success/error)

### `apps/web/src/app/page.tsx`

- Passes `onActivity={handleActivity}` to `ChatPanel`

## Activity events emitted

| Trigger | Event text | Type |
|---|---|---|
| Block detected | `Chat write proposal detected — creating proposal…` | info |
| Proposal created | `Chat write proposal created for workspace/<path>` | write |
| Proposal failed | `Chat write proposal failed for <path>: <error>` | error |
| Parse error | `Chat write proposal parse error: <error>` | error |
| Approve success | `Chat write approved and applied to workspace/<path>` | write |
| Approve failure | `Chat write approval failed for <path>: <error>` | error |
| Cancel | `Chat write proposal cancelled for workspace/<path>` | info |

## Known limitations

- Only one pending chat-created proposal is supported at a time. Sending a new message discards any pending proposal.
- The target file must already exist in the workspace (new file creation not yet supported).
- The fenced block remains visible in the assistant message; there is no rendering that hides or replaces it.
- Proposals are stored in-memory on the API server — restarting the API discards all pending proposals.

## What comes next (v0.3.3+)

- Support creating new workspace files from chat proposals (target path does not need to exist).
- Render the `jarvis-write-proposal` block in a styled "Jarvis proposed a change" callout instead of raw fenced text.
- Allow multiple pending proposals from a single response (one per block).

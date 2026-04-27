# Decision 024 — Write-with-Approval Foundation (v0.3.0)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

All previous workspace features were strictly read-only. v0.3.0 introduces the first file-write capability for Jarvis. Because writes are irreversible operations, they require an explicit two-step flow: **propose → approve**. No file is ever written without the user clicking "Approve write."

This is a foundation — not a full AI edit agent. Ollama cannot trigger writes. The UI exposes a controlled test edit (append a reviewer comment). The full AI-assisted edit flow is planned for a later version.

## Workflow

```
User clicks "Propose safe edit"
    → POST /files/propose-write { path, content }
        → backend validates path (workspace sandbox)
        → backend reads current file
        → backend computes diff
        → backend stores proposal in memory (UUID key)
        → returns { id, diff, before, after }

UI shows diff with Approve / Cancel buttons

User clicks "Approve write"
    → POST /files/approve-write { proposalId }
        → backend looks up proposal by ID
        → backend re-validates path (defense-in-depth)
        → backend writes proposal.after to disk
        → deletes proposal from store
        → returns { path, written: true }

UI reloads file preview and directory listing
```

## What was implemented

### Backend — `apps/api/src/services/writeTools.ts` (new)

**`computeDiff(before, after)`** — pure function, no external dependencies. Uses common prefix/suffix detection to produce line-by-line diff: `unchanged | removed | added` per line. Handles append, prepend, replace, and delete operations correctly for typical workspace files.

**`proposeWrite(relativePath, proposedContent)`**:
- Prunes expired proposals before processing
- Enforces `MAX_PROPOSALS = 20` concurrent limit
- Calls `resolveWorkspacePath()` — reuses the existing path traversal guard
- Verifies target is an existing regular file
- Rejects content > 200 KB (mirrors the read limit)
- Generates UUID proposal ID via `crypto.randomUUID()`
- Stores proposal in a module-level `Map<string, WriteProposal>` (in-memory, never persisted)
- Logs to `console.log`

**`approveWrite(proposalId)`**:
- Looks up proposal by UUID
- Re-calls `resolveWorkspacePath(proposal.path)` and checks it matches `proposal.resolvedPath` — defense-in-depth against any theoretical store tampering
- Writes with `fs.writeFileSync(resolvedPath, proposal.after, "utf-8")`
- Deletes proposal from store (one-time approval — cannot approve twice)
- Logs to `console.log`

**Proposal TTL:** 30 minutes. Expired proposals are pruned on the next `proposeWrite` call.

### Backend — `apps/api/src/routes/files.ts` (extended)

Two new routes:

**`POST /files/propose-write`**  
- Body: `{ path: string, content: string }`  
- Validates both fields are non-empty strings  
- Returns `{ ok: true, id, path, before, after, diff }`  
- Returns `{ ok: false, error }` on any failure  

**`POST /files/approve-write`**  
- Body: `{ proposalId: string }`  
- Returns `{ ok: true, path, written: true }`  
- Returns `{ ok: false, error }` if proposal not found/expired  

### Frontend — `apps/web/src/components/WorkspacePanel.tsx` (extended)

**New types:**
- `DiffLine` — `{ type: "unchanged" | "added" | "removed"; content: string }`
- `Proposal` — `{ id, path, diff: DiffLine[] }`
- `DisplayLine` — diff line or `{ type: "gap"; count: number }`

**`getDisplayLines(diff)`** — collapses long unchanged sections to 5 lines of context on each side of the nearest change. Produces a compact, readable diff for any file size.

**New state variables:**
- `proposal: Proposal | null` — active pending proposal
- `proposalLoading: boolean` — proposal creation in-flight
- `proposalError: string | null` — proposal creation error
- `approveLoading: boolean` — approval in-flight
- `approveError: string | null` — approval error
- `writeSuccess: boolean` — shown after successful write

**New functions:**
- `handleProposeEdit()` — calls `POST /files/propose-write` with current file + appended comment
- `handleApprove()` — calls `POST /files/approve-write`, then reloads file content in-place and refreshes directory listing
- `handleCancelProposal()` — clears proposal state

**"Propose safe edit" button** — amber/yellow styling to visually distinguish it from read-only operations (cyan = read, amber = write pending approval).

**Preview area layout when proposal active:**
```
[filename]                    [×]
─────────────────────────────────
⚠ Pending write approval
  Nothing has been written yet.
─────────────────────────────────
[diff lines — scrollable]
  ··· N unchanged lines ···
+  added line content
─────────────────────────────────
[Approve write]    [Cancel]
```

All `closePreview` and `handleSelectFile` calls reset proposal state, so proposals never leak between files.

## Safety properties

| Property | How it is enforced |
|---|---|
| Only workspace paths | `resolveWorkspacePath()` in both propose and approve |
| Path traversal rejected | `resolveWorkspacePath()` uses `path.resolve` + prefix check |
| Double-approval impossible | Proposal deleted from store after first approval |
| No agentic writes | Ollama cannot call these endpoints — user must click buttons |
| Content size limit | 200 KB cap on proposed content |
| Proposal capacity limit | Max 20 concurrent proposals |
| Proposal expiry | 30-minute TTL, pruned on next propose call |
| No new file creation | `proposeWrite` requires the target file to already exist |
| No deletes / renames / moves | Not implemented — explicitly out of scope |

## v0.3.0 test edit

The "Propose safe edit" button appends this exact string to the file:

```
\n\n<!-- Proposed by Jarvis: review before keeping. -->\n
```

This is a reversible, clearly-labelled test. The user can always delete it. Future versions will let Jarvis propose meaningful edits based on chat context.

## Known limitations

- Proposals are stored in memory — restarting the API server discards all pending proposals.
- `computeDiff` uses prefix/suffix detection, not LCS. It will produce less accurate diffs for files with interleaved changes (e.g., inserting a line in the middle of similar content).
- The "Propose safe edit" button only appends a fixed comment — no AI-generated edit content yet.
- Write activity is logged to `console.log` only; not integrated with the ActivityPanel log feed.
- New file creation (writing a path that doesn't exist) is not yet supported.

## What comes next (v0.3.1+)

- Let chat output propose a write (structured tool call, still requires approval).
- Support creating new files inside the workspace.
- Integrate write events into the ActivityPanel log feed.
- Implement a proper LCS-based diff for more accurate multi-hunk change display.

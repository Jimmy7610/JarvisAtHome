# Decision 032 — Create New File With Approval

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.4.0 added local email drafts via `workspace/drafts/`. The write-with-approval flow was reused, but `proposeWrite` threw `"File does not exist."` for any path that did not already exist on disk. Email drafts always target new files, so the approval panel never appeared.

## Root cause

`proposeWrite` had this block:

```typescript
if (!fs.existsSync(resolvedPath)) {
  throw new Error("File does not exist.");
}
```

The original design only handled editing existing files. New-file creation was never considered.

## Changes

### `apps/api/src/services/writeTools.ts`

**`WriteProposal` interface** — added `operation: "edit" | "create"` field.

**`proposeWrite`** — replaced the hard `"File does not exist."` throw with a branch:

- **File exists** → existing behavior: stat-check it's a regular file, read current content as `before`, set `operation = "edit"`.
- **File does not exist** → new path:
  1. Check the parent directory exists (`path.dirname(resolvedPath)`) and is a directory. Throws `"Parent directory does not exist."` if not. This prevents silent directory creation.
  2. Set `before = ""`.
  3. Set `operation = "create"`.
  4. Compute `computeDiff("", proposedContent)` — produces all lines as "added", giving a clean green diff.
  
All other checks (path validation via `resolveWorkspacePath`, content size, proposal count limit) run identically for both operations. The path traversal protection from `resolveWorkspacePath` is unchanged.

**`approveWrite`** — `fs.writeFileSync` already creates new files when the parent directory exists. Only two changes:
- Return type extended with `operation: "edit" | "create"` so callers can distinguish.
- Console log now includes the operation name.

**`path` import** — added `import path from "path"` for `path.dirname`.

### `apps/web/src/components/ChatPanel.tsx`

- `chatProposal` state type: added `operation: "edit" | "create"`.
- `detectAndPropose`: `propose-write` response type extended with `operation?`; `setChatProposal` passes `operation: data.operation ?? "edit"` (fallback for older API responses).
- Pending approval panel: added "new file" badge and adjusted description text when `chatProposal.operation === "create"`.

## Safety properties preserved

| Property | Status |
|---|---|
| Path traversal blocked by `resolveWorkspacePath` | Unchanged |
| Parent directory must pre-exist (no auto mkdir) | Enforced on propose |
| Path re-validated at approve time (defense-in-depth) | Unchanged |
| Content size limit (200 KB) | Unchanged |
| Proposal count limit (max 20) | Unchanged |
| Proposal TTL (30 min) | Unchanged |
| Nothing written without explicit Approve click | Unchanged |
| Edit flow for existing files | Unchanged |

## What is NOT allowed

- Creating files in directories that do not already exist inside the workspace
- Creating files outside `workspace/`
- Creating directories (only files)
- Bypassing the diff/approve step

## Files changed

| File | Change |
|---|---|
| `apps/api/src/services/writeTools.ts` | `proposeWrite` handles create; `approveWrite` returns operation; `path` import added |
| `apps/web/src/components/ChatPanel.tsx` | `chatProposal` type, API response type, "new file" badge and label |
| `docs/decisions/032-create-new-file-with-approval.md` | This document |
| `README.md` | Short note added |

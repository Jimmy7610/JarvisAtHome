# Decision 070 — Multi-file Write Proposal Foundation (v1.2.0)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

The existing write-with-approval flow (v0.3.x) handles one file per assistant
response.  As Jarvis is used for project scaffolding and multi-component tasks,
models naturally want to propose several related files together (e.g. a new
TypeScript module + its type file + an updated index).  v1.2.0 adds a v2
proposal format that carries multiple files in one block, while keeping full
backward compatibility with the v1 single-file format.

Proposals can be delivered in two ways:
- **Assistant-generated** — the assistant response contains a `jarvis-write-proposal`
  fenced block or bare JSON; detected by `detectAndPropose()` after streaming ends.
- **User-pasted** — the user pastes a proposal block directly into the chat input
  and clicks Send; intercepted in `send()` before the Ollama call is made.

## Safety contract

- **Approval required** — `POST /files/approve-write` must be called per file.
  Nothing is written without an explicit user click.
- **Sequential, not batch** — the frontend calls the existing endpoints one file
  at a time.  No new backend endpoint is added.
- **Stops on first failure** — if any file is rejected (bad path, size limit,
  traversal attempt) the remaining files are not written.
- **Max 5 files per proposal** — enforced in `detectAndPropose()` before any
  API call.
- **No delete operation** — the backend only supports `edit` / `create`.  The
  v2 format accepts `"create"` and `"update"` operations only.
- **Workspace sandbox unchanged** — `resolveWorkspacePath()` still guards every
  file at both propose and approve time.
- **JarvisBrain untouched** — no changes to prompt, model config, or agent logic.

## v2 proposal JSON format

```json
{
  "type": "workspace_write_proposal",
  "version": 2,
  "summary": "Optional human-readable description of the change set.",
  "files": [
    {
      "operation": "create",
      "path": "relative/path/to/file.ts",
      "content": "file content here"
    },
    {
      "operation": "update",
      "path": "another/file.ts",
      "content": "updated content here"
    }
  ]
}
```

- `type` and `version: 2` distinguish it from the v1 `{path, content}` shape.
- `summary` is optional — shown as italic text in both the message callout and
  the approval banner.
- `operation` must be `"create"` or `"update"` (maps to `"create"` / `"edit"` in
  `writeTools.ts`).
- `path` is a workspace-relative path; the backend resolves and validates it.
- `content` is the full file content string.

## User-pasted proposal interception

When the user pastes a proposal block into the chat input and clicks Send,
`send()` calls `matchProposalBlock(trimmed)` before any API call.  If a match
is found:

1. The file count is read from the JSON body for the Activity Log.
2. An activity event is emitted: `"Write proposal detected from user input: N file(s)"`.
3. The raw pasted text is added as a user bubble (persisted to SQLite).
4. `detectAndPropose(trimmed)` is called — the same path used for assistant responses.
5. `send()` returns early — Ollama is never called.

This required two sub-fixes:

- **`extractWriteProposal` extended** — after brace-balanced JSON extraction, the
  function previously validated `path` (string) and `content` (string) and
  returned `null` for any JSON that lacked those fields.  A v2 multi-file block
  pasted with the `jarvis-write-proposal` fence marker was therefore silently
  rejected before the interception could fire, causing Ollama to be called
  instead.  The validation now checks v2 format first (`isMultiFileProposal()`)
  and only falls through to v1 validation if the object is not a v2 proposal.

- **`extractBareJsonProposal` extended** — previously only accepted v1 format
  (`{path, content}`).  Now also accepts v2 format via `isMultiFileProposal()`.
  This allows bare-pasted v2 JSON (without any fence) to be detected by
  `matchProposalBlock()`.  Both functions use `isMultiFileProposal()` which is
  safe to call before its declaration thanks to JavaScript function hoisting.

- **Stale state clearing extended** — `send()` now clears `chatMultiProposals` and
  `chatMultiSummary` at the top alongside `chatProposal`, so a new proposal
  (pasted or assistant-generated) always replaces any previously pending proposal.

## Detection algorithm (`isMultiFileProposal`)

A pure TypeScript type guard added at module level in `ChatPanel.tsx`:

```typescript
function isMultiFileProposal(obj: unknown): obj is MultiFileProposalJson {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    o.type === "workspace_write_proposal" &&
    o.version === 2 &&
    Array.isArray(o.files) &&
    (o.files as unknown[]).length > 0
  );
}
```

Called inside `detectAndPropose()` after JSON parsing.  If it returns true the
v2 path runs; otherwise the existing v1 path runs unchanged.

## Frontend flow

### `detectAndPropose(text)` — extended

1. `matchProposalBlock(text)` extracts the JSON body (marker path or bare-JSON
   fallback — unchanged from v1).
2. Parse JSON.
3. `isMultiFileProposal(parsed)` → **v2 path**:
   - Validate `fileCount ≤ 5`.
   - Validate each file: non-empty `path`, string `content`, valid `operation`.
   - POST `/files/propose-write` for each file sequentially.
   - Accumulate results into `chatMultiProposals[]`.
   - Set `chatMultiSummary`.
   - Log `"Chat write proposal: N files pending approval"` (write event).
4. Otherwise → **v1 path** (unchanged).

### `handleApproveAll()` — new

Loops through `chatMultiProposals`, calling `POST /files/approve-write` for
each.  Stops on first failure, setting `chatApproveError`.  On full success:
clears `chatMultiProposals`, sets `chatWriteSuccess`.

### `handleChatCancelProposal()` — extended

Now also clears `chatMultiProposals` and `chatMultiSummary`.  Logs the file
count when cancelling a multi-file proposal.

## UI

### Message callout (`AssistantMessage`)

`parseProposalBlock()` now returns `{ before, after, paths: string[], summary: string }`.

| Condition | Callout heading |
|---|---|
| `paths.length === 1` | "Jarvis proposed a workspace file change" + single path |
| `paths.length > 1` | "Jarvis proposed N workspace file changes" + path list |
| `summary` present | Italic summary line below heading |

### Approval banner

| Element | Description |
|---|---|
| Header badge | "N files" amber badge (multi) or "email draft" cyan badge (single drafts/) |
| Summary | Italic amber text from `chatMultiSummary` |
| Per-file section | Rounded header: `workspace/path`, "new file" badge if create, "N/M" counter |
| Per-file diff | Scrollable (max 140 px) with `getDisplayLines()` context windowing |
| Approve button | "Approve all N files" — green, disabled while loading |
| Cancel button | Clears all multi-file state |

## Activity Log events

| Event | Type |
|---|---|
| `Chat write proposal detected: N files — creating proposals…` | info |
| `Chat write proposal: N files pending approval` | write |
| `Chat write approved and applied to workspace/<path>` (per file) | write |
| `Chat write approved: N files written` | write |
| `Chat write proposal cancelled (N files)` | write |
| `Chat write proposal failed for <path>: <reason>` | error |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `MultiFileProposalJson` type + `isMultiFileProposal()` guard; `extractBareJsonProposal()` extended to accept v2; `chatMultiProposals`, `chatMultiSummary`, `chatApproveAllLoading` state; `send()` — stale multi-file state clearing + user-pasted proposal interception; `detectAndPropose()` v2 branch; `handleApproveAll()`; `handleChatCancelProposal()` multi-file clear; banner multi-file section; `parseProposalBlock()` updated return type; `AssistantMessage` callout updated |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.2.0"` |
| `apps/web/src/app/page.tsx` | sidebar footer |
| `apps/web/src/components/SettingsPanel.tsx` | version fallbacks → `"1.2.0"`; Multi-file proposals badge → done |
| `README.md` | heading → v1.2.0; multi-file proposals feature bullet |
| `docs/decisions/070-multi-file-write-proposal-foundation.md` | This document |

## What is NOT changed

- No new backend endpoints — existing `/files/propose-write` and
  `/files/approve-write` are reused
- No database schema changes
- No automatic writes — approval is always required per file
- v1 single-file proposal format — fully unchanged and still supported
- JarvisBrain — untouched
- WorkspacePanel — no changes needed (write proposals are a ChatPanel concern)

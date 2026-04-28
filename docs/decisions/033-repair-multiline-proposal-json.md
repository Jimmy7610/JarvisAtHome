# Decision 033 — Repair Multiline JSON in Write Proposals

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.4.0 added local email drafts via `workspace/drafts/`. In practice, local Ollama
models frequently violate the JSON spec by emitting literal newline characters inside
JSON string values instead of the required `\n` escape sequence.  A typical malformed
proposal block looks like:

```
```jarvis-write-proposal
{"path":"drafts/cleaning-day-board.md","content":"# Email Draft: Cleaning Day Board Meeting

To: The Ollama Board
Subject: Cleaning Day Next Saturday

Hello everyone,
...
"}
```
```

`JSON.parse` throws on this input because the JSON specification forbids unescaped
literal newlines inside string values (RFC 8259 §7).  The write-proposal panel never
appeared even though the model clearly intended a valid email draft proposal.

## Root cause

`extractWriteProposal` in `ChatPanel.tsx` used brace-balancing to locate the JSON
body, which worked correctly — the literal newlines are treated as regular characters
by the depth counter.  The extracted `jsonBody` string was then passed directly to
`JSON.parse`, which correctly (per spec) rejected it.  There was no recovery path.

## Changes

### `apps/web/src/components/ChatPanel.tsx`

**New function `repairMultilineProposalJson`** added above `extractWriteProposal`.

- Called **only** after `JSON.parse(jsonBody)` throws **and** the
  `jarvis-write-proposal` marker was already confirmed present.
- Extracts `path` via strict regex: `"path"\s*:\s*"([^"\r\n\\]+"` — path values
  never legitimately contain newlines or quotes, so the regex is safe and tight.
- Extracts `content` by slicing from the character immediately after `"content":"`
  to just before the final `"` + `}` at the end of the body.  Literal newlines in
  this slice are **preserved as actual file content** — they are the newlines the
  model intended to write into the file.
- Unescapes `\"` → `"` and `\\` → `\` within the content slice to handle any
  standard JSON escape sequences the model may have correctly emitted for characters
  other than newlines.
- Returns `null` if either field cannot be reliably extracted, allowing the parser
  to fall through to `null` (no proposal created) rather than silently producing
  garbage.

**Safety checks in `repairMultilineProposalJson`:**
- `path` must be non-empty.
- `path` must not start with `/`, `\`, or a Windows drive letter (`C:`…).
- `path` must not contain `../`, `..\`, `/..`, or `\..`.
- Backend `resolveWorkspacePath` remains the authoritative path guard.

**`extractWriteProposal` updated:**
- `jsonBody` changed from `const` to `let` so it can be replaced.
- On `JSON.parse` failure, calls `repairMultilineProposalJson(jsonBody)`.
- On successful repair, re-encodes the result with `JSON.stringify` and stores it
  back into `jsonBody`.  All downstream callers (`detectAndPropose`,
  `parseProposalBlock`) receive standard valid JSON and require no changes.

### `apps/api/src/services/ollama.ts`

Added two `CRITICAL` lines to the `JARVIS_SYSTEM_PROMPT` workspace file proposals
rules section:

> CRITICAL: Never put literal newline characters inside the JSON string values. Use
> the `\n` escape sequence instead.
>
> CRITICAL: The entire JSON object must fit on a single line between the opening and
> closing fences. No line breaks inside the JSON.

The existing correct/wrong examples and all other rules are unchanged.

## How the repair works — worked example

**Input `jsonBody` (from brace-balancer):**
```
{"path":"drafts/foo.md","content":"# Hello

World"}
```
(where the blank line is a real `\n` character, not `\n`)

**Step 1 — path regex** matches `drafts/foo.md`. No traversal → accepted.

**Step 2 — content key match** finds `"content":"` at offset X.

**Step 3 — closing match** finds `"}` at the very end of the string.

**Step 4 — slice** gives `# Hello\n\nWorld` (real newlines preserved).

**Step 5 — unescape** nothing to unescape in this example.

**Output:** `JSON.stringify({ path: "drafts/foo.md", content: "# Hello\n\nWorld" })`  
→ `{"path":"drafts/foo.md","content":"# Hello\n\nWorld"}` — valid JSON.

## What is NOT changed

| Property | Status |
|---|---|
| Write-with-approval flow | Unchanged — nothing is written automatically |
| Backend path validation (`resolveWorkspacePath`) | Unchanged |
| Parent directory must pre-exist | Unchanged |
| Content size limit (200 KB) | Unchanged |
| Proposal TTL and count limits | Unchanged |
| Bare-JSON fallback (`extractBareJsonProposal`) | Unchanged |
| Email draft flow | Unchanged |
| New file creation flow | Unchanged |
| Activity Log events | Unchanged |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `repairMultilineProposalJson` added; `extractWriteProposal` uses repair on JSON.parse failure |
| `apps/api/src/services/ollama.ts` | Two CRITICAL lines added to system prompt JSON rules |
| `docs/decisions/033-repair-multiline-proposal-json.md` | This document |
| `README.md` | Short note added |

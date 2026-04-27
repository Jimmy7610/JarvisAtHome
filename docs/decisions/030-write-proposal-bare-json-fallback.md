# Decision 030 — Write Proposal Bare-JSON Fallback

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

During UI testing the model returned:

```
{"path":"welcome.md","content":"# Test File\nHello World!\nThis is just a test."}
```

The JSON object is structurally correct — it has `path` and `content` — but the `jarvis-write-proposal` fence marker was completely absent. The existing `extractWriteProposal` function uses `text.indexOf("jarvis-write-proposal")` as its first step and returns `null` immediately. So detection failed, no amber callout appeared, and no approval panel was shown.

## Root cause

Local Ollama models drift from system prompt instructions. The model "understood" it needed to return a JSON object but ignored the custom fence marker, producing either bare JSON or a standard ` ```json ` fence. This is a known failure mode for smaller quantised models.

## Changes

### A — Stronger system prompt (`apps/api/src/services/ollama.ts`)

Rewrote the workspace file proposals section of `JARVIS_SYSTEM_PROMPT` to be more directive:

- Added a **CORRECT** example with label before the rules
- Added three explicit **WRONG** examples showing exactly what not to do: bare JSON, plain fence, ```` ```json ```` fence
- Added rule: "The opening fence line MUST be exactly: ```` ```jarvis-write-proposal ````"
- Added rule: "Never output a bare JSON object — the fence and marker are not optional"
- Added rule: "Never use ```` ```json ```` or plain ```` ``` ```` as the fence type"
- Strengthened the opening sentence: "The marker `jarvis-write-proposal` is MANDATORY — never omit it, never replace it"

The goal is to reduce future model drift. The bare-JSON fallback (below) is the safety net for when drift still occurs.

### B — Strict bare-JSON fallback (`apps/web/src/components/ChatPanel.tsx`)

Added `extractBareJsonProposal(text): string | null` — a new function that fires ONLY after `extractWriteProposal` returns null (no marker found). It is intentionally strict.

**Strict conditions for the fallback to fire (ALL must be true):**
1. The entire trimmed assistant response is either:
   - A raw JSON object: trimmed text starts with `{` and ends with `}`
   - A single fenced JSON block: trimmed text matches ```` /^```(?:json)?\s*\r?\n([\s\S]+?)\r?\n[ \t]*```\s*$/ ````
2. `JSON.parse` succeeds on the extracted body
3. `parsed.path` is a non-empty string
4. `parsed.content` is a string

**Rejected by the fallback:**
- Any surrounding explanatory prose (if there's prose before/after, the text no longer starts with `{` or matches the fence regex from start-to-end)
- Malformed or partial JSON
- JSON missing `path` or `content` fields

**Accepted formats:**

Raw JSON only:
```
{"path":"welcome.md","content":"# Test File\nHello World!\nThis is just a test."}
```

Fenced JSON only (entire response is the fence, nothing before or after):
```json
{"path":"welcome.md","content":"..."}
```

**Updated `matchProposalBlock`:** now tries `extractWriteProposal` first (preferred), then `extractBareJsonProposal` (fallback). Returns the same shape either way so all callers (`detectAndPropose`, `parseProposalBlock`, `AssistantMessage`) work without changes.

For the bare-JSON fallback path, `index` is set to `leadingSpace` (the offset after any leading whitespace) and `fullMatch` spans the entire trimmed content. This makes `parseProposalBlock` compute empty `before` and `after` segments — the amber callout replaces the entire raw JSON display.

**Activity log differentiation:** `detectAndPropose` now checks `!text.includes("jarvis-write-proposal")` to log `"Chat write proposal detected (bare JSON fallback) — creating proposal…"` when the fallback fired, vs the normal message for the marker path.

## Formats now supported

| Format | Detection path |
|---|---|
| ```` ```jarvis-write-proposal\n{...}\n``` ```` | Preferred — marker-based parser |
| ```` ```\njarvis-write-proposal\n{...}\n``` ```` | Preferred — marker on next line (Format B) |
| ```` ```jarvis-write-proposal\n{...} ```` (no closing fence) | Preferred — brace-balanced, no closing fence needed |
| Raw JSON only: `{...}` | Fallback — `extractBareJsonProposal` |
| ```` ```json\n{...}\n``` ```` (entire response) | Fallback — `extractBareJsonProposal` |
| ```` ```\n{...}\n``` ```` (entire response) | Fallback — `extractBareJsonProposal` |

## Safety notes

- No write safety rules changed
- The fallback creates only a PENDING proposal — backend `/files/propose-write` is called, diff is shown, user must click Approve
- Backend path validation and sandbox enforcement are unchanged
- The fallback rejects any response with surrounding prose, so arbitrary model output cannot trigger it accidentally
- The existing `extractWriteProposal` brace-balanced parser is unchanged and still the preferred path

## Files changed

| File | Change |
|---|---|
| `apps/api/src/services/ollama.ts` | `JARVIS_SYSTEM_PROMPT` — workspace proposals section strengthened with CORRECT/WRONG examples and explicit rules |
| `apps/web/src/components/ChatPanel.tsx` | Added `extractBareJsonProposal`; updated `matchProposalBlock` to try fallback; updated `detectAndPropose` activity message |
| `docs/decisions/030-write-proposal-bare-json-fallback.md` | This document |

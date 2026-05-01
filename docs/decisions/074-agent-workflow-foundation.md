# Decision 074 — Agent Workflow Foundation (v1.3.0)

**Date:** 2026-05-01
**Status:** Accepted and implemented

## Context

Jarvis has a strong write-proposal approval model (v0.3.0 → v1.2.3) but no way
to present a structured multi-step plan before implementing anything.  v1.3.0
adds a lightweight planning UI — the "agent workflow foundation" — that lets the
model produce an ordered, step-by-step plan for user review.  No step runs
automatically.  No files are written by the plan itself.

## Design goals

- **Planning only** — the plan panel is read-only except for per-step status
  toggles (Done / Reset) which the user controls manually.
- **No new write paths** — the plan never touches the write-proposal flow.  If
  a step requires file writes, a separate `jarvis-write-proposal` block must be
  submitted and approved in the normal way.
- **No autonomous execution** — the model cannot mark steps done, start the
  next step, or write anything without explicit user approval.
- **Safe fallback** — invalid or unrecognised plan blocks are silently ignored;
  chat always continues normally.
- **No backend required** — plan state lives only in component state.  The plan
  resets on page refresh.  Persistence is deferred to a later milestone.

## Plan block format

```jarvis-agent-plan
{
  "type": "jarvis_agent_plan",
  "version": 1,
  "title": "Implement feature X",
  "summary": "Optional high-level summary",
  "steps": [
    {
      "id": "1",
      "title": "Inspect current code",
      "description": "Review relevant files and identify safe change points.",
      "kind": "analysis",
      "status": "planned"
    }
  ]
}
```

### Validation rules

| Field | Requirement |
|---|---|
| `type` | Must be exactly `"jarvis_agent_plan"` |
| `version` | Must be exactly `1` |
| `title` | Non-empty string |
| `summary` | Optional string |
| `steps` | Non-empty array, max 10 items |
| `steps[].id` | Non-empty string |
| `steps[].title` | Non-empty string |
| `steps[].description` | String (may be empty) |
| `steps[].kind` | Optional; allowed: `analysis`, `code`, `docs`, `test`, `review` |
| `steps[].status` | Optional; allowed: `planned`, `in_progress`, `done`, `blocked`; default `planned` |

Unknown `kind`/`status` values are silently dropped (normalised to `undefined`/`"planned"`).

## Detection

### Preferred: fenced block with marker

```
```jarvis-agent-plan
{ ... }
```
```

`extractAgentPlanFromFence(text)` — same brace-balancing technique as
`extractWriteProposal`.  Finds the `jarvis-agent-plan` marker, scans to the
first `{`, brace-balances to the closing `}`, then validates with `isAgentPlan`.

### Fallback: bare JSON

`extractBareAgentPlan(text)` — fires ONLY when the entire trimmed text is a
single `{...}` object or a ` ```json ` fenced block.  Validated with
`isAgentPlan`.  Mirrors `extractBareJsonProposal`.

### Adapter

`matchAgentPlanBlock(text)` — tries fenced first, then bare.  Returns the raw
JSON string or `null`.

## User-pasted plan interception

In `send()`, before the write-proposal interception:

1. Call `matchAgentPlanBlock(trimmed)`.
2. If a valid plan JSON is found, call `parseAgentPlan(jsonBody)`.
3. If the plan parses successfully:
   - Add user bubble, clear input.
   - Persist message, auto-title session if first message.
   - Call `setChatAgentPlan(plan)`.
   - Return early — Ollama is **not** called.
4. If the plan is invalid, fall through to normal write-proposal / Ollama path.

## Assistant-generated plan detection

After streaming ends (alongside `detectAndPropose`):

```typescript
detectAndSetAgentPlan(assistantText);
```

Non-throwing: invalid plans log an info event and return.  Valid plans call
`setChatAgentPlan(plan)` and log an Activity event.

## State

`chatAgentPlan: AgentPlanState | null` in ChatPanel.

Cleared by:
- New `send()` call (stale-clearing block at the top of `send`)
- `handleClearPlan()` (× button)

NOT persisted — resets on page refresh.

## Plan panel UI

- Cyan border/accent to visually distinguish from amber write-proposal banners.
- Header: **Agent Plan** label · step count badge · `X/N done` progress counter · × dismiss button.
- Plan title (medium weight) + optional summary (muted).
- Always-visible safety note: *"Planning only. Steps do not run automatically."*
- Scrollable step list (max 260 px).
- Per-step: index · title (strikethrough when done) · kind badge · status badge · Done/Reset button.
- Status colours: done → green; blocked → red; in_progress → amber; planned → muted grey.

## System prompt hint

A compact section appended to `JARVIS_SYSTEM_PROMPT` in `ollama.ts`:

- Shows the block format with an example.
- States: plans are for user review only; steps never run automatically.
- States: file writes still require a separate `jarvis-write-proposal` block.
- Limits: max 10 steps; valid kind/status values listed.

## Safety contract

- **No new write paths** — plan panel never calls `/files/propose-write` or `/files/approve-write`.
- **No autonomous actions** — nothing runs, nothing is written until the user explicitly approves a write proposal.
- **Backend unchanged** — no new API routes, no database changes.
- **Chat preserved** — invalid or missing plan blocks are silently ignored; chat continues normally.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | Agent plan types, type guard, extractor, parser, state, handlers, plan interception in `send()`, `detectAndSetAgentPlan` call after streaming, plan panel JSX |
| `apps/api/src/services/ollama.ts` | Agent plan hint appended to `JARVIS_SYSTEM_PROMPT` |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.3.0"` |
| `apps/web/src/app/page.tsx` | Sidebar footer → `v1.3.0 — agent workflow foundation` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.3.0"`; Feature Status rows; Safety card — Agent execution row |
| `README.md` | Heading → v1.3.0; agent workflow foundation feature bullet |
| `docs/decisions/074-agent-workflow-foundation.md` | This document |

## What is NOT changed

- No new backend endpoints
- No database schema changes
- Single-file and multi-file write proposal flows — completely unchanged
- Per-file Include/Skip — completely unchanged
- JarvisBrain — untouched

## Next steps

- Plan persistence (survive page refresh) — save/restore from backend session or localStorage.
- Per-step notes / comments field.
- In-progress step indicator while Jarvis is responding.
- Full agent workflow: model can suggest the next action for the user to approve.

# Decision 077 — Agent Active Step Indicator (v1.3.3)

**Date:** 2026-05-02
**Status:** Accepted and implemented

## Context

v1.3.2 added per-step notes.  v1.3.3 adds the ability to mark exactly one step
as the "current" or "active" step, giving the user a visual focus point while
working through a multi-step plan.

## Design goals

- **Single active step** — at most one step can be `in_progress` at a time.
- **Manual only** — the user sets the active step; nothing sets it automatically.
- **Reuse `in_progress` status** — no new field or status value needed.  The
  existing `status: "in_progress"` is the canonical representation.
- **Persistent** — active step survives page refresh via the existing per-session
  localStorage plan persistence.
- **Non-disruptive** — existing behaviour of Mark done / Reset / Clear is
  unchanged.  The model can still emit `in_progress` in a plan block and it will
  be respected.

## State/data model

No new fields are needed.  `AgentPlanStep.status` already allows `"in_progress"`.

### Invariant

At most one step with `status === "in_progress"` in any `AgentPlanState`.

### `handleSetStepActive(stepId)`

Inside the `setChatAgentPlan` state updater:

1. Find the target step.
2. Guard: if target is `done` or not found, return `prev` unchanged.
3. Map over steps:
   - target step → `in_progress`
   - any other step that is currently `in_progress` → `planned`
   - all others → unchanged
4. Save to localStorage; log activity event (title only, no content).

### Interaction with existing handlers

| Handler | Effect on active step |
|---|---|
| `handleMarkStepDone(stepId)` | Sets `done`; active indicator disappears naturally |
| `handleResetStep(stepId)` | Sets `planned`; step is no longer active |
| `handleClearPlan()` | Removes the entire plan including active state |

## UI

### Plan header

A `▶ <step title>` label appears next to the progress counter when a step is
`in_progress`.  Truncated with `max-w` to avoid overflowing short headers.

### Per-step action buttons

| Status | Buttons shown |
|---|---|
| `planned` | **Set active** (amber) + **Done** (green) |
| `blocked` | **Set active** (amber) + **Done** (green) |
| `in_progress` | **Done** (green) only |
| `done` | **Reset** (muted) only |

### Row highlight

`in_progress` rows use a stronger amber background and border:
`bg-amber-900/20 border-amber-500/50` (vs. the previous `bg-amber-900/10
border-amber-700/30`).

## Safety contract

- Active step is a visual planning aid only.
- `handleSetStepActive` never calls any API endpoint.
- Active step status is never sent to Ollama.
- Active step never triggers file writes, shell commands, or write proposals.
- Backend unchanged; database unchanged.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `handleSetStepActive` handler; plan header ▶ indicator; strengthened `in_progress` row highlight; action buttons column split into Set active / Done / Reset tiers |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.3.3"` |
| `apps/web/src/app/page.tsx` | Sidebar footer → `v1.3.3 — agent active step indicator` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.3.3"`; Agent active step indicator Feature Status row; Safety card — Agent active step row |
| `README.md` | Heading → v1.3.3; active step indicator feature bullet |
| `docs/decisions/077-agent-active-step-indicator.md` | This document |

## What is NOT changed

- No new backend endpoints
- No database schema changes
- Write proposal flows — completely unchanged
- Per-file Include/Skip — completely unchanged
- Mark done / Reset / Clear plan — unchanged behaviour
- Step notes — completely unchanged
- Plan persistence helpers — unchanged
- JarvisBrain — untouched

## Next steps

- Full agent workflow: model suggests the next concrete action for the user to
  approve (e.g. pre-fills a write proposal or a chat message).
- In-progress step indicator while Jarvis is actively streaming a response to a
  step question (auto-set active, auto-clear on response).

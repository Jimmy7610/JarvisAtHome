# Decision 076 — Agent Plan Step Notes (v1.3.2)

**Date:** 2026-05-01
**Status:** Accepted and implemented

## Context

v1.3.1 made agent plans persistent per chat session.  v1.3.2 adds per-step
manual annotations ("notes") so the user can record observations, links, or
reminders alongside each planning step without leaving the plan panel.

## Design goals

- **Manual-only** — notes are written and controlled entirely by the user.  The
  model never reads them, never writes them, and they never trigger actions.
- **Local** — notes live inside the `AgentPlanState` in localStorage.  No new
  API routes, no database changes.
- **Persistent** — notes are saved alongside the plan (same localStorage key,
  same per-session map) so they survive page refresh and session switch.
- **Non-disruptive** — existing plans without notes load correctly; the `note`
  field is optional everywhere.
- **Bounded** — max 1000 chars, trimmed on save.  Empty save = clear note.

## Data model

```typescript
interface AgentPlanStep {
  id: string;
  title: string;
  description: string;
  kind?: AgentPlanStepKind;
  status: AgentPlanStepStatus;
  note?: string;   // ← new in v1.3.2; optional; max 1000 chars
}
```

Plans already in localStorage (without `note`) continue to load fine because
the field is optional.

## Parsing

`AgentPlanJson` accepts an optional `note` string per step.  `parseAgentPlan()`
trims and caps it at 1000 chars; absent or empty becomes `undefined`.  This
means a user-pasted plan block that already contains notes is accepted cleanly.

## UI state

```typescript
const [editingNoteStepId, setEditingNoteStepId] = useState<string | null>(null);
const [editingNoteText, setEditingNoteText] = useState<string>("");
```

Only one note editor is open at a time.  Clearing the plan also closes any open
editor so stale state cannot linger.

## Handlers

| Handler | Action |
|---|---|
| `handleEditStepNote(stepId)` | Opens editor pre-filled with existing note |
| `handleSaveStepNote(stepId)` | Trims text, updates plan state, saves localStorage, logs activity |
| `handleCancelStepNote()` | Discards draft, closes editor |
| `handleClearStepNote(stepId)` | Removes note from step, saves localStorage, logs activity |

Saving with an empty/whitespace-only text clears the note (same effect as Clear
note).  Activity events log the step title only — never the note content.

`handleSaveStepNote` uses the `setChatAgentPlan` state updater so the value
written to localStorage is guaranteed to match the value committed to React state
(no stale-closure risk).

## UI layout (per step, inside the plan panel)

```
[idx] [title] [kind badge] [status badge]       [Done/Reset]
     Description text here.
     ┌─────────────────────────────────────┐
     │ Note: User-written annotation text  │  ← only when note exists
     └─────────────────────────────────────┘
     + Add note                              ← only when no note
     Edit note · Clear note                  ← only when note exists, not editing
     ┌─────────────────────────────────────┐
     │ [textarea]                          │  ← only when editing this step
     └─────────────────────────────────────┘
     [Save note] [Cancel]
```

## Safety contract

- **Notes are never injected into the system prompt or any API request.**
- **Notes never trigger actions, proposals, or file writes.**
- **No backend endpoint is added or modified.**
- **Backend unchanged; database unchanged.**

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `note?` on `AgentPlanStep` + `AgentPlanJson`; `parseAgentPlan` carries note; `editingNoteStepId` / `editingNoteText` state; 4 note handlers; plan panel JSX — note display, editor, action buttons |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.3.2"` |
| `apps/web/src/app/page.tsx` | Sidebar footer → `v1.3.2 — agent plan step notes` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.3.2"`; Agent plan step notes Feature Status row; Safety card — Agent step notes row |
| `README.md` | Heading → v1.3.2; step notes feature bullet |
| `docs/decisions/076-agent-plan-step-notes.md` | This document |

## What is NOT changed

- No new backend endpoints
- No database schema changes
- Write proposal flows — completely unchanged
- Per-file Include/Skip — completely unchanged
- Mark done / Reset / Clear plan — completely unchanged
- Plan persistence helpers — unchanged (notes piggyback on existing save/load)
- JarvisBrain — untouched

## Next steps

- In-progress step indicator while Jarvis is actively streaming a response.
- Full agent workflow: model suggests the next concrete action for the user to approve.

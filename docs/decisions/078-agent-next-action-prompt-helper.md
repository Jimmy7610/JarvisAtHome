# Decision 078 — Agent Next-Action Prompt Helper (v1.3.4)

**Date:** 2026-05-02
**Status:** Accepted and implemented

## Context

v1.3.3 added the active step indicator.  v1.3.4 adds a lightweight helper that
bridges the plan panel and the chat input: clicking **Ask Jarvis** on any step
pre-fills the chat textarea with a structured prompt about that step, so the user
does not have to copy/paste step details manually.

## Design goals

- **Manual prefill only** — clicking Ask Jarvis never calls Ollama, never sends,
  and never changes any plan state.
- **Safety-first prompt** — the generated prompt instructs the model not to write
  files directly, requiring a `jarvis-write-proposal` block and user approval.
- **No new persistence** — the prefill is transient; it only sets the `input`
  state in ChatPanel.
- **Non-disruptive** — the button is a small muted link placed alongside the
  existing note buttons, so it does not crowd the step row.

## Generated prompt structure

```
I am working on this Jarvis agent plan:

Plan: <title>
Summary: <summary>       ← omitted if no summary

Current step:
- Title: <step title>
- Kind: <kind>           ← omitted if no kind
- Status: <status>
- Description: <desc>    ← omitted if empty
- Note: <note>           ← omitted if no note

Help me with this step. Do not write files directly. If file changes are needed,
use a jarvis-write-proposal block and wait for approval.
```

Optional fields (summary, kind, description, note) are only included when
non-empty so the prompt stays concise.

## Implementation

### Handler

`handleAskAboutStep(stepId)`:

1. Look up the step in `chatAgentPlan`.
2. Build lines array, skipping empty optional fields.
3. Call `setInput(prompt)`.
4. Trigger textarea auto-resize (same pattern as the clipboard fallback in the
   multi-file template helper):
   ```typescript
   textareaRef.current.style.height = "auto";
   textareaRef.current.style.height = `${Math.min(scrollHeight, 200)}px`;
   textareaRef.current.focus();
   ```
5. Log `Agent step prompt prepared: <step title>` activity event.

### Button placement

In the note actions row (not the right-column action buttons) so the step card
doesn't grow wider.  The row already has Add/Edit/Clear note links; Ask Jarvis
is appended with the same `·` separator:

```
+ Add note  ·  Ask Jarvis
Edit note  ·  Clear note  ·  Ask Jarvis
```

The button uses `text-cyan-700 hover:text-cyan-400` to be subtly distinguishable
from the grey note buttons without being distracting.

## Safety contract

- `handleAskAboutStep` never calls any API endpoint.
- `handleAskAboutStep` never calls `send()`.
- The generated prompt does not contain secret or personal data — only plan/step
  fields the user explicitly entered.
- The prompt explicitly instructs the model to use `jarvis-write-proposal` if
  files are needed — reinforcing the existing write-approval safety model.
- Step status, notes, and active indicator are completely unchanged.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `handleAskAboutStep` handler; Ask Jarvis button in note actions row |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.3.4"` |
| `apps/web/src/app/page.tsx` | Sidebar footer → `v1.3.4 — agent next-action prompt helper` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.3.4"`; Agent next-action prompt helper Feature Status row |
| `README.md` | Heading → v1.3.4; feature bullet |
| `docs/decisions/078-agent-next-action-prompt-helper.md` | This document |

## What is NOT changed

- No new backend endpoints
- No database schema changes
- Write proposal flows — completely unchanged
- Plan persistence — completely unchanged
- Step status / notes / active indicator — completely unchanged
- JarvisBrain — untouched

## Next steps

- Full agent workflow: model suggests the next concrete action for the user to
  approve (e.g. a write proposal linked to the active step).
- Auto-active step while Jarvis is streaming a response to a step's Ask Jarvis
  prompt.

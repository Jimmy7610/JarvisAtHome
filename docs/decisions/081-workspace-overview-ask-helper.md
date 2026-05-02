# Decision 081 — Workspace Overview Ask Helper (v1.4.1)

**Date:** 2026-05-02
**Status:** Accepted and implemented

## Context

v1.4.0 added a read-only workspace overview panel (file counts, extension chart,
largest/recent files, project hints).  v1.4.1 closes the loop: give the user a
one-click way to feed that metadata into a chat message so the local Ollama model
can reason about the workspace structure.

## Design goals

- **No auto-send** — the prompt is placed in the input field only.  The user must
  press Send.
- **Metadata only** — the prompt contains counts, paths, sizes, and dates.  No
  file content is ever included.
- **Reuse existing plumbing** — uses the same `prefillInput` / `onConsumePrefill`
  mechanism that "Ask Jarvis about this file" already relies on.  Zero new
  ChatPanel props needed.
- **Switch to chat automatically** — `setView("chat")` in `page.tsx` so the user
  lands in the right place immediately.
- **Activity event** — `Workspace overview queued for chat analysis` is emitted
  to the Activity Log for auditability.

## Implementation

### `generateOverviewPrompt(data: OverviewData): string`

Module-level pure function in `WorkspacePanel.tsx`.  Builds a multi-line plain
text prompt:

```
I want you to analyze this workspace overview and suggest safe next improvements.

Workspace overview:
- Total files: X
- Total folders: Y
- [cap warning if applicable]
- Top file types: .ts (12), .tsx (8), .md (4), ...
- Largest files:
  - path/to/file.ts (42 KB)
- Recently modified:
  - path/to/file.ts (5/2/2026)
- Detected project files: README, package.json, tsconfig.json

Please suggest safe next improvements. Do not write files directly.
If file changes are needed, use a jarvis-write-proposal block and wait for approval.
```

### `onAskAboutOverview?: (prompt: string) => void` prop

New optional prop on `WorkspacePanel`.  When provided, the "Ask Jarvis about this
workspace" button is rendered inside the overview panel, just above the read-only
safety note.  The button is disabled until `overviewData` is populated and no
reload is in progress.

### Button click handler

```typescript
onClick={() => {
  if (overviewData) {
    onAskAboutOverview(generateOverviewPrompt(overviewData));
  }
}}
```

### `handleAskAboutOverview(prompt: string)` in `page.tsx`

```typescript
function handleAskAboutOverview(prompt: string): void {
  setPrefillInput(prompt);
  setView("chat");
  handleActivity("Workspace overview queued for chat analysis", "info");
}
```

Reuses the pre-existing `prefillInput` state and `handleConsumePrefill` flow.
No new state, no new ChatPanel props.

## Safety contract

- `generateOverviewPrompt` only receives an `OverviewData` object — the same
  metadata shape returned by the backend.  It calls no APIs and reads no files.
- The prompt appended safety instruction mirrors the one used by
  `handleAskAboutStep` in ChatPanel.
- The button is conditionally rendered only when `onAskAboutOverview` is provided
  — WorkspacePanel used without the prop is unchanged.
- Absolute paths never appear in the prompt (workspace-relative paths only,
  same as the overview response).

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/WorkspacePanel.tsx` | `generateOverviewPrompt()` helper; `onAskAboutOverview` prop; "Ask Jarvis about this workspace" button in overview panel |
| `apps/web/src/app/page.tsx` | `handleAskAboutOverview()`; `onAskAboutOverview` prop passed to WorkspacePanel; sidebar footer → `v1.4.1` |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.4.1"` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.4.1"`; Feature Status row |
| `README.md` | Heading → v1.4.1; feature bullet |
| `docs/decisions/081-workspace-overview-ask-helper.md` | This document |

## What is NOT changed

- `ChatPanel.tsx` — no new props, no new state
- `fileTools.ts` / `files.ts` — backend untouched
- All existing workspace overview behaviour
- All other workspace, chat, memory, agent plan features

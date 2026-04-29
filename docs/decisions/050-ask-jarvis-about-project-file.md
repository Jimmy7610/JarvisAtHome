# Decision 050 - Ask Jarvis About Project File (v0.7.2)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.7.1 added "Attach to chat" for Project Library files — users could attach a
file and then type their own question. v0.7.2 adds a one-click shortcut that
both attaches the file and prefills the chat input with a useful default question,
matching the equivalent feature in WorkspacePanel (introduced in v0.2.4).

## Behaviour

Clicking "Ask Jarvis" in the Project Library file view:

1. Attaches the currently previewed file as a project file attachment chip in ChatPanel.
2. Prefills the chat input with:
   `Explain this project file and suggest safe improvements.`
3. Does nothing else — no message is sent automatically.

The user can edit the prefilled question before sending.

## Why reuse the existing `prefillInput` mechanism

`ChatPanel` already has a `prefillInput` / `onConsumePrefill` prop pair used by
WorkspacePanel's "Ask Jarvis about this file". Reusing the same mechanism means:

- No new props or state added to ChatPanel.
- The consume pattern (apply once, reset to null) already works and is tested.
- The implementation in `page.tsx` is a single function call:
  ```typescript
  setAttachedProjectFile({ projectName, path, content, size });
  setPrefillInput("Explain this project file and suggest safe improvements.");
  ```

## Why two separate buttons instead of one

"Attach to chat" and "Ask Jarvis" serve different intent:

| Button | What it does |
|---|---|
| Attach | Queues the file silently — user writes their own question |
| Ask Jarvis | Queues the file + fills in a suggested question |

Keeping them separate means a user who wants to write their own question from
scratch is not forced to clear a prefill they didn't want.

## Button label rationale

"Ask Jarvis" is shorter than "Ask Jarvis about this file" and fits the compact
right-sidebar layout without wrapping. The tooltip `title` attribute carries
the full description: `"Attach this file and prefill a question in chat"`.

The button uses indigo styling (matching the project file attachment chip) to
signal it is a project-library-specific action.

## Existing "Attach to chat" label

Shortened from "Attach to chat" to "Attach" to keep both buttons on the same
line in the compact metadata bar. The full label was redundant — the context
(file preview in Project Library panel) makes the meaning clear.

## No ChatPanel changes needed

ChatPanel is not modified. The `prefillInput` useEffect:
```typescript
useEffect(() => {
  if (prefillInput) {
    setInput(prefillInput);
    onConsumePrefill?.();
  }
}, [prefillInput]);
```
handles input population for both workspace and project file ask flows. The
parent (`page.tsx`) resets `prefillInput` to null via `handleConsumePrefill`.

## Safety

- File content comes from the safe `GET /projects/:name/file` route (200 KB cap,
  binary check, extension allowlist, traversal protection).
- Nothing is written, edited, or deleted.
- No proposal is created automatically.
- No message is sent automatically.
- Project Library remains read-only.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ProjectLibraryPanel.tsx` | Added `onAskAboutFile` prop; added "Ask Jarvis" button in file content metadata bar; shortened "Attach to chat" → "Attach" |
| `apps/web/src/app/page.tsx` | Added `handleAskAboutProjectFile` handler; wired `onAskAboutFile` to ProjectLibraryPanel |
| `docs/decisions/050-ask-jarvis-about-project-file.md` | This document |
| `README.md` | Version bumped to v0.7.2, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| ChatPanel | Unchanged |
| Backend `/projects` routes | Unchanged |
| WorkspacePanel "Ask Jarvis about this file" | Unchanged |
| WorkspacePanel attachment flow | Unchanged |
| Write-with-approval flow | Unchanged |
| TTS system | Unchanged |
| SQLite persistence | Unchanged |
| Project Library read-only guarantee | Unchanged |

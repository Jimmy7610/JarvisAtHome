# Decision 059 — Memory Opt-In Chat Context (v0.9.1)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.9.0 added a manual memory layer (local SQLite) but intentionally kept memory
isolated from chat — memory was displayed, added, and deleted, but never sent to
Ollama.

v0.9.1 adds the first memory → chat injection path, controlled entirely by the
user on a per-note, per-message basis.

## Safety constraints (non-negotiable)

| Constraint | Status |
|---|---|
| User must explicitly toggle each note | ✅ per-note "Include" button in MemoryPanel |
| AI/model cannot select or inject memory | ✅ no backend path from /chat to /memory |
| Injection is opt-in per message, never automatic | ✅ snapshot at send time, no background injection |
| Memory content never logged to activity log | ✅ only titles logged in activity events |
| Memory sent only to local Ollama endpoint | ✅ no cloud path |
| Selection can always be cleared by user | ✅ "Clear all" in MemoryPanel and × chip in ChatPanel |

## User flow

1. User opens Memory view.
2. Each note has an **Include** button. Clicking it toggles the note into the
   chat context selection (button changes to **✓ In context**).
3. A summary banner appears at the top of MemoryPanel:
   *"N notes included in chat context · sent with your next message"*
4. User switches to Chat view. A purple chip appears above the input:
   *"Memory context: N notes · <title list>"*
5. User types a message and sends it.
6. The selected notes are prepended to the outgoing API message as a labeled block
   (see format below). The user bubble shows `[Memory context: N notes]`.
7. Selection is **not** cleared after send — the user keeps the same context for
   follow-up messages until they deselect or click "Clear all".

## Context injection format

```
The user explicitly selected the following local memory notes as chat context:

[preference] UI preference
Jimmy prefers compact dark UI with readable panels.

[project] Jarvis project note
Jarvis should remain local-first and Ollama-only.

<user's typed message here>
```

Memory context is prepended first, then file attachments, then the user's question.
This puts the broadest context outermost so the model sees it before file-level detail.

## State ownership

`selectedMemoryContext: MemoryContextItem[]` lives in `page.tsx` because both
`MemoryPanel` (toggle buttons) and `ChatPanel` (chip + injection) need access.

- `page.tsx` exports `MemoryContextItem` and owns add/remove/clear handlers.
- `MemoryPanel` receives `selectedMemoryIds: Set<string>` (for toggle UI) and
  `onToggleMemoryContext` / `onClearMemoryContext` callbacks.
- `ChatPanel` receives `memoryContext` and `onClearMemoryContext`.

No backend changes. Injection is purely frontend — the composed `apiMessage` string
(including memory block) is sent to the existing `/chat/stream` endpoint unchanged.

## What this is NOT

- Memory is not searched or ranked automatically.
- The AI cannot read, write, add, or remove memories.
- There is no RAG, no vector database, no semantic search.
- Memory selection does not persist across page reloads (by design for v0.9.1).

## Activity log events

| Action | Event text |
|---|---|
| Note toggled in | `Memory included in context: <title>` |
| Note toggled out | `Memory removed from context: <title>` |
| All cleared | `Memory context cleared` |
| Message sent with context | `Memory context injected: <title1>, <title2>…` |

Content is never logged.

## Files changed

| File | Change |
|---|---|
| `apps/api/src/routes/settings.ts` | `appVersion` bumped to `"0.9.1"` |
| `apps/web/src/app/page.tsx` | `MemoryContextItem` type exported; `selectedMemoryContext` state; `handleMemoryContextToggle` / `handleMemoryContextClear`; props wired to MemoryPanel and ChatPanel; version string |
| `apps/web/src/components/MemoryPanel.tsx` | New props `selectedMemoryIds`, `onToggleMemoryContext`, `onClearMemoryContext`; per-note Include toggle button; selection summary banner |
| `apps/web/src/components/ChatPanel.tsx` | New props `memoryContext`, `onClearMemoryContext`; memory context chip in input bar; memory block prepended to `apiMessage` in `send()`; user bubble label |
| `apps/web/src/components/SettingsPanel.tsx` | Memory card updated; Feature Status updated; footer version |
| `docs/decisions/059-memory-opt-in-chat-context.md` | This document |
| `README.md` | Version bumped to v0.9.1; feature bullet added |

## What is NOT changed

All chat streaming, session management, model selector, write approval, workspace,
project library, TTS, right sidebar, and backend routes are unchanged.
JarvisBrain repository untouched.

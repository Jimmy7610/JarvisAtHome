# Decision 064 — Per-Chat Memory Context Scoping

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

v0.9.2 introduced persistent memory context selection using a single flat
`localStorage` key `jarvis:selected-memory-context-ids`. That key stored an
array of selected memory note UUIDs shared globally across all chat sessions.

This caused a UX problem: selecting memory notes in Chat A would make them
appear in Chat B, Chat C, and any new chat. The selection was not scoped to
the conversation where it was made — it leaked across all sessions.

## Decision

Memory context selection is now scoped per chat session.

- Each session has its own independent memory selection.
- Switching chats restores that chat's own saved selection.
- New chats always start with an empty selection.
- Clearing context only affects the current chat.
- Deleted memory notes are cleaned from every session's saved selection.

## Implementation

### localStorage shape

**Old (removed):** `jarvis:selected-memory-context-ids` — a flat array of UUIDs
shared across all sessions.

**New:** `jarvis:memory-context-by-session` — a JSON object (map) keyed by
session ID string, where each value is an array of memory note UUIDs:

```json
{
  "42": ["uuid-a", "uuid-b"],
  "57": ["uuid-c"]
}
```

Only UUIDs are stored — never titles, content, or any memory body text.
Full memory content always stays in local SQLite only.

### Migration

On first startup after upgrading, `removeOldGlobalMemoryContextKey()` removes
the old `jarvis:selected-memory-context-ids` key. The old global selection is
**not** migrated to any session. Applying an unknown global list to specific
chats would confuse the user — starting clean is safer.

The migration function is idempotent (no-op if the key is already gone). It is
called in a one-time `useEffect(() => { ... }, [])` in `page.tsx`.

### Key helpers (all in page.tsx)

| Helper | Purpose |
|---|---|
| `readMemoryContextMap()` | Read full session → IDs map from localStorage |
| `writeMemoryContextMap(map)` | Write full map back |
| `readMemoryContextIdsForSession(sessionId)` | Get saved IDs for one session |
| `writeMemoryContextIdsForSession(sessionId, ids)` | Persist IDs for one session |
| `clearMemoryContextForSession(sessionId)` | Remove one session's entry from the map |
| `removeMemoryIdFromAllSessions(memoryId)` | Clean a deleted ID from every session |
| `removeOldGlobalMemoryContextKey()` | One-time migration helper |

### State management

`selectedMemoryContext: MemoryContextItem[]` remains owned by `page.tsx`.

The memory restore `useEffect` now depends on `[activeSessionId]` instead of
`[]`. It fires:

- On initial page load when `activeSessionId` becomes non-null (session resolved
  from localStorage or newly created)
- On every session switch
- When a new chat is created

On each fire: reads saved IDs for the active session, fetches `GET /memory`,
and rebuilds `selectedMemoryContext` from the IDs that still exist in SQLite.
Stale IDs (deleted notes) are cleaned up in place.

Session switch handlers (`handleSwitchSession`, `handleNewChat`,
`handleDeleteSession`) call `setSelectedMemoryContext([])` synchronously before
setting the new `activeSessionId`. This ensures the old context is cleared
immediately while the async fetch runs in the background.

### Deleted memory cleanup

`handleMemoryDeleted(id)` now calls `removeMemoryIdFromAllSessions(id)` which
walks the entire per-session map and removes the deleted ID from every entry.
This means no chat session can retain a stale reference to a deleted note.

### Session delete cleanup

`handleDeleteSession(id)` now calls `clearMemoryContextForSession(id)` for any
deleted session (not just the active one), so the map does not accumulate
entries for sessions that no longer exist in the backend.

## UI changes

| Location | Before | After |
|---|---|---|
| MemoryPanel button (not selected) | `Include` | `In this chat` |
| MemoryPanel button (selected) | `✓ In context` | `✓ In this chat` |
| MemoryPanel button title attr (not selected) | `Include in chat context` | `Include in this chat` |
| MemoryPanel button title attr (selected) | `Remove from chat context` | `Remove from this chat` |
| MemoryPanel summary banner | `… included in chat context · sent with your next message` | `… included in this chat · this chat only` |
| MemoryPanel banner clear button title | `Remove all from chat context` | `Remove all from this chat's context` |
| ChatPanel memory chip | `Memory context: N notes · … titles` | `Memory context: N notes · … titles · this chat only` |
| SettingsPanel Memory card label | `Selected for chat` | `Selected for this chat` |

All wording changes reinforce that the selection is scoped to the current chat,
not global.

## What is NOT changed

- Memory add/delete, search, filter
- Memory opt-in context injection mechanism (still opt-in, still manual)
- Memory nav badge total count (remains global — all notes)
- Memory nav badge active count (reflects current chat's selection)
- GET /memory backend endpoint — unchanged
- SQLite schema — unchanged
- JarvisBrain repository — untouched

## Files changed

| File | Change |
|---|---|
| `apps/web/src/app/page.tsx` | New per-session localStorage helpers; memory restore effect depends on `activeSessionId`; updated toggle/clear/delete handlers; session switch/new/delete handlers clear context immediately |
| `apps/web/src/components/MemoryPanel.tsx` | Button labels and summary banner wording updated to "this chat" |
| `apps/web/src/components/ChatPanel.tsx` | Memory context chip adds "this chat only" helper text |
| `apps/web/src/components/SettingsPanel.tsx` | "Selected for chat" label → "Selected for this chat" |
| `README.md` | Per-chat memory context bullet added; "does not do" section updated |
| `docs/decisions/064-memory-context-per-chat.md` | This document |

# Decision 013 — Backend Chat Persistence: Phase 2 (Read from Backend)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

Phase 1 (decision 012) made the backend a write-only mirror of chat activity. `localStorage` remained the source of truth for restoring chat history on page load. This meant history was still tied to the browser — clearing `localStorage` would lose it even though it was safely stored in SQLite.

Phase 2 makes SQLite the preferred source for restoring history on startup.

## What was implemented

All changes are confined to `apps/web/src/components/ChatPanel.tsx`.

### New type

`BackendMessage` — matches the row shape returned by `GET /sessions/:id`:
```typescript
interface BackendMessage {
  id: number;
  session_id: number;
  role: "user" | "assistant" | "error" | "cancelled";
  content: string;
  model: string | null;
  created_at: string;
}
```

### New helper: `loadSessionFromBackend(sessionId)`

```
GET /sessions/:id
  → ok + messages array → map { content→text, role→role } → ChatMessage[]
  → ok:false or empty → null
  → network error → console.warn + null
```

Returns `null` in all failure cases so callers can degrade gracefully.

### `historySource` state

`useState<"backend" | "local" | null>(null)` — tracks where history was loaded from. Shown as a dim indicator in the chat header: `history: backend` or `history: local`.

### Updated mount `useEffect` — backend-first load order

```
1. Check localStorage for jarvis.session.v1.
2. If session id exists:
   a. Call loadSessionFromBackend(id).
   b. If messages returned: use them, sync to localStorage, set historySource = "backend".
   c. If null (backend down / empty): use localStorage history, set historySource = "local".
3. If no session id:
   a. Use localStorage history.
   b. Create new session in background (createSession).
   c. Set historySource = "local".
```

### Header indicator

A very dim `history: backend` or `history: local` label appears in the chat header subtitle next to the context count. Uses `text-slate-700` — barely visible, present for confirmation without being distracting.

## What did NOT change

- `localStorage` is still written to on every send (Phase 1 write-through is unchanged).
- `buildHistory()` filtering is unchanged.
- The backend session endpoints are unchanged.
- No UI layout changes.
- No new API endpoints.

## Behaviour table

| Scenario | Result |
|---|---|
| Session id in localStorage + backend has messages | History from SQLite; localStorage synced as cache |
| Session id in localStorage + backend unreachable | History from localStorage |
| Session id in localStorage + session has no messages | History from localStorage (or greeting) |
| No session id | History from localStorage; new session created |

## What comes next

- **Phase 3**: Session list sidebar — `GET /sessions`, switching between sessions, delete.
- **Future**: Auto-generated session titles from first user message.

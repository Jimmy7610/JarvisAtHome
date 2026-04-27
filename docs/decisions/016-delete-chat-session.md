# Decision 016 — Delete Chat Session

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

Sessions could be created and switched, but there was no way to remove them. The sidebar would grow indefinitely. A delete action was needed, but it is destructive, so it must require confirmation and must not operate on multiple sessions at once.

## What was implemented

### Backend: `DELETE /sessions/:id`

New endpoint added to `apps/api/src/routes/sessions.ts`.

- **Validates** that the id is numeric. Returns `{ ok: false, error: "Invalid session id." }` if not.
- **Checks** that the session exists. Returns `{ ok: false, error: "Session not found." }` if not.
- **Deletes** the row from `chat_sessions`. All associated `chat_messages` rows are removed automatically via the `ON DELETE CASCADE` foreign key constraint — no separate delete needed.
- **Returns** `{ ok: true, deletedSessionId: 123 }` on success.
- HTTP status is always 200; success is signalled by the `ok` field (consistent with all other routes).

### Frontend: `SessionList.tsx` — delete button per row

Each session row in the sidebar is now a flex container with two children:

1. **Select button** (`flex-1`) — clicking it switches to the session, unchanged from before.
2. **Delete button** (`flex-shrink-0`) — a small `×` character, `opacity-0` by default, fades to `opacity-100` on group hover. Uses `e.stopPropagation()` so clicking it does not also trigger the select button.

The delete button calls `window.confirm` before doing anything:

```
Delete chat "My title"? This cannot be undone.
```

If the user clicks Cancel, nothing happens. If they click OK, `onDelete(id)` is called.

No keyboard shortcut. No bulk delete. No hidden automatic delete.

### Frontend: `page.tsx` — `handleDeleteSession`

New async handler:

1. Calls `DELETE /sessions/:id`.
2. If the request fails (network error or `ok: false`), logs a `console.warn` and returns — the UI is unaffected.
3. If the deleted session was the **active** session:
   - Clears `jarvis.chat.v1` from localStorage.
   - Calls `createNewSession()` to create a replacement session and write its id to `jarvis.session.v1`.
   - Sets the new id as `activeSessionId` — ChatPanel remounts via the `key` prop with an empty session.
4. Calls `fetchSessions()` to refresh the sidebar (removes the deleted row).

If deletion succeeds on a **non-active** session, steps 3 is skipped — only the list refresh runs.

## Session ID safety

After deleting the active session, `handleDeleteSession` calls `createNewSession()` which writes the new id to `jarvis.session.v1` before setting React state. The UI never reaches a state where `jarvis.session.v1` points to a deleted session.

## What did NOT change

- No bulk delete.
- No keyboard shortcut for delete.
- No automatic or silent delete.
- The write-through persistence, backend-first restore, auto-title, and session switching are all unchanged.
- The streaming, cancel, and conversation context features are unchanged.

## Known limitations

- If the backend is unreachable when delete is attempted, the confirmation has already been shown. The request silently fails and the session remains in the list — no user-visible error.
- The `×` delete button relies on CSS group-hover (`opacity-0 group-hover:opacity-100`). On touch devices without hover, the button is never visible. Touch support is deferred.

## What comes next

- Session rename from the sidebar.
- Keyboard shortcut for new chat.
- Touch-friendly delete (long press or swipe-to-reveal).

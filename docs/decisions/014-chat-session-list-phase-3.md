# Decision 014 — Chat Session List: Phase 3

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

Phase 2 (decision 013) established SQLite as the preferred source for restoring chat history on startup. However, the UI only ever showed one conversation — the one stored in `jarvis.session.v1`. There was no way to see past sessions or start a fresh one.

Phase 3 adds session browsing and switching to the left sidebar.

## What was implemented

### Backend: `PATCH /sessions/:id`

New endpoint added to `apps/api/src/routes/sessions.ts`.

- **Purpose:** Update a session's title.
- **Body:** `{ "title": "string" }` — validated, max 80 chars.
- **Returns:** `{ ok: true, session: { id, title, created_at, updated_at } }`.
- **Used by:** ChatPanel auto-title after the first user message.

### Frontend: `apps/web/src/app/page.tsx` — converted to client component

`page.tsx` now owns session state. It:
- Reads `jarvis.session.v1` from localStorage on mount.
- If a session ID is stored, uses it immediately.
- If no session ID is stored, creates a new session via `POST /sessions` before rendering ChatPanel.
- Fetches the sessions list via `GET /sessions` on mount and after new-session creation.
- Provides `handleSwitchSession` and `handleNewChat` handlers.
- Passes `key={activeSessionId ?? "new"}` to `ChatPanel` — React remounts ChatPanel cleanly whenever the session changes.
- Gates `ChatPanel` behind `sessionReady` state to prevent a double-mount on initial load.

### Frontend: `apps/web/src/components/SessionList.tsx` — new component

Rendered inside the left sidebar between the nav items and the version footer.

- **"+ New Chat" button** — calls `handleNewChat` in page.tsx.
- **Sessions list** — scrollable, ordered by `updated_at DESC` (backend provides this order).
- **Active session** highlighted with `bg-slate-700/60 text-slate-200`.
- **Each item** shows truncated title + formatted date ("Today", "Yesterday", or "YYYY-MM-DD").
- No delete or rename UI in this phase.

### Frontend: `apps/web/src/components/ChatPanel.tsx` — additions

**`updateSessionTitle(sessionId, title)`** — new module-level helper; calls `PATCH /sessions/:id`; fire-and-forget.

**Auto-title**: In `send()`, before the user turn is added, checks `!messages.some(m => m.role === "user")`. If true (first message), calls `updateSessionTitle(sid, trimmed.slice(0, 50))` after the user message persists.

**Unmount cleanup effect**: New `useEffect` with an empty dependency array returns a cleanup function that calls `abortControllerRef.current?.abort()`. This aborts any in-flight streaming request if the user switches sessions while a response is being generated.

## Session switching mechanism

When the user clicks a session in the sidebar:
1. `handleSwitchSession(id)` writes the new id to `localStorage` (`jarvis.session.v1`).
2. `setActiveSessionId(id)` triggers a re-render.
3. `<ChatPanel key={id} />` causes React to unmount the old ChatPanel and mount a fresh one.
4. The new ChatPanel reads the updated `jarvis.session.v1` from localStorage and loads history from the backend via `GET /sessions/:id`.

## What did NOT change

- No delete or rename UI.
- No semantic memory / RAG.
- No session title editing by the user.
- `localStorage` remains the fallback if the backend is unreachable.
- The write-through persistence from Phase 1 is unchanged.
- The backend-first restore from Phase 2 is unchanged.
- The `clearChat` button clears the UI and localStorage cache only — backend messages are preserved.
- The streaming, cancel, context, and conversation history features are unchanged.

## Known limitations

- The session list does not auto-refresh when the active session's title is updated by auto-title (requires a page reload or manual `+ New Chat`).
- If a session is switched while streaming, the old request is aborted by the unmount cleanup — the partial assistant text is NOT saved to the old session on cancel-by-switch.
- Session list ordering reflects backend `updated_at` at the time of the last `fetchSessions()` call, not in real-time.

## What comes next

- Auto-refresh the sessions list after title updates (e.g. `onTitleUpdated` callback or polling).
- Session delete with confirmation.
- Keyboard shortcut for new chat.

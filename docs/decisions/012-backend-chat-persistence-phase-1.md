# Decision 012 — Backend Chat Persistence: Phase 1 (Write-Through)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

Chat history was stored only in browser `localStorage` (decision 005). Planning (010) and dependency verification (011) confirmed SQLite with `better-sqlite3` is suitable for local server-side persistence.

Phase 1 implements a **write-through** pattern: the backend becomes a mirror of chat activity while `localStorage` remains the primary source of truth for the UI. No UI change is visible to the user.

## What was implemented

### Backend

**`apps/api/src/services/db.ts`** — Database singleton  
- Opens `data/memory/jarvis.sqlite` on startup (creates `data/memory/` if missing).
- Path resolved relative to `__dirname` so it is portable — no hardcoded absolute paths.
- Overridable via `JARVIS_DB_PATH` environment variable.
- Runs schema DDL (`CREATE TABLE IF NOT EXISTS`) on every startup — idempotent, safe to re-run.
- Enforces foreign keys: `PRAGMA foreign_keys = ON`.

**Schema**
```sql
chat_sessions  (id, title, created_at, updated_at)
chat_messages  (id, session_id, role, content, model, created_at)
```
`ON DELETE CASCADE` ensures messages are removed when a session is deleted.  
Index on `(session_id, created_at)` for efficient message retrieval.

**`apps/api/src/routes/sessions.ts`** — Session endpoints  

| Method | Path | Purpose |
|---|---|---|
| `POST /sessions` | Create a new session |
| `GET /sessions` | List 50 most recent sessions |
| `GET /sessions/:id` | Get session + all messages |
| `POST /sessions/:id/messages` | Append a message to a session |

All endpoints return HTTP 200 with `{ ok: true/false }` — consistent with the existing API style.  
`POST /sessions/:id/messages` validates role (allowed set), content (non-empty, max 20 000 chars), and updates `session.updated_at` atomically in a transaction.

### Frontend

**`apps/web/src/components/ChatPanel.tsx`** — Write-through layer

New module-level helpers (no component state):
- `loadSessionId()` / `saveSessionId()` — read/write `jarvis.session.v1` in localStorage.
- `createSession()` — `POST /sessions`; stores the returned id; returns null if unreachable.
- `persistMessage()` — `POST /sessions/:id/messages`; never throws; logs failures as `console.warn`.

New component state:
- `sessionIdRef` — holds the active backend session id; null until `ensureSession` resolves.

Mount `useEffect` (existing):
- Existing localStorage history load is unchanged.
- Added: re-use stored session id, or call `createSession()` once if none exists.

`send()` changes:
- `sid = sessionIdRef.current` captured before any `await`.
- User message persisted immediately after being added to UI (fire-and-forget).
- `assistantText` accumulated locally as tokens arrive (replaces reading from React state).
- `modelName` captured from the `done` chunk.
- Successful response: `persistMessage(sid, "assistant", assistantText, modelName)`.
- Mid-stream error: `persistMessage(sid, "error", errorText)`.
- Cancel with partial text: `persistMessage(sid, "assistant", assistantText, modelName)`.
- Cancel with no text: `persistMessage(sid, "cancelled", "Response cancelled.")`.
- Network/API error: `persistMessage(sid, "error", msg)`.

## What did NOT change

- `localStorage` is still the source of truth for the UI on page load.
- The chat hydration flow is unchanged.
- No new UI elements were added.
- `buildHistory()` filtering is unchanged.
- The `POST /chat/stream` endpoint is unchanged.

## Data safety

- Database file is at `data/memory/jarvis.sqlite` — gitignored by `data/memory/` and `*.sqlite` rules. Confirmed with `git check-ignore`.
- No secrets stored — only chat content already visible to the user.
- Backend persistence failures are silent to the user (`console.warn` only).

## What comes next

- **Phase 2**: On mount, `GET /sessions/:id/messages` loads history from the backend instead of localStorage. localStorage becomes a cache/fallback.
- **Phase 3**: Session list sidebar — `GET /sessions`, session switching, delete session.

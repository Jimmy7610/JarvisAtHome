# Backend Chat Persistence — Architecture Plan

**Status:** Planning only. No code has been changed.  
**Date:** 2026-04-27  
**Supersedes:** localStorage-only chat history (decision 005)

---

## 1. Why move to SQLite

Browser `localStorage` is:
- Per-browser and per-origin — chat history is lost when switching browsers or devices.
- Capped (~5 MB) — long conversations will eventually hit the quota.
- Invisible to the backend — Jarvis cannot search, summarize, or act on past conversations.

SQLite is:
- A single file on disk, fully local, no server required.
- Fast for read-heavy workloads like chat history retrieval.
- Already gitignored (`*.sqlite`, `data/memory/`) — no risk of committing private data.
- The natural foundation for future memory features (v0.3).

---

## 2. Database file location

```
C:\Users\Jimmy\Documents\GitHub\Jarvis\data\memory\jarvis.sqlite
```

Configured via environment variable so it can be moved without code changes:

```env
JARVIS_DB_PATH=./data/memory/jarvis.sqlite
```

The API must create `data/memory/` at startup if it does not exist (Node `fs.mkdirSync` with `recursive: true`).

**Gitignore status:** Already covered by two separate rules in `.gitignore`:
- `data/memory/` — directory exclusion
- `*.sqlite` — extension exclusion

No `.gitignore` changes needed.

---

## 3. Schema

Keep it minimal. Two tables only.

### `chat_sessions`

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL DEFAULT 'New Chat',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

`title` starts as "New Chat" and can be auto-generated from the first user message later (e.g. first 60 chars). Not needed for the first implementation step.

### `chat_messages`

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK(role IN ('user', 'assistant', 'error', 'cancelled')),
  content    TEXT    NOT NULL,
  model      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

- `model` is NULL for user messages; populated for assistant messages (from the `done` chunk).
- `role` mirrors the existing `ChatMessage` interface in `ChatPanel.tsx`.
- `error` and `cancelled` roles are stored so the UI can reconstruct exactly what the user saw.
- No JSON metadata blob yet — add only when a concrete use case requires it.

---

## 4. Recommended package

**`better-sqlite3`** (+ `@types/better-sqlite3`)

Reasons:
- Synchronous API — fits naturally in Express without async/await complications.
- Very fast for local single-user workloads.
- Widely used and well-maintained.
- Good TypeScript support.

**Windows note:** `better-sqlite3` is a native Node.js module. It requires native compilation tools (Visual Studio Build Tools or the `windows-build-tools` npm package). If the build fails, the fallback is `sql.js` (pure WebAssembly, no native deps, slightly slower).

Do not install either package until the implementation step.

---

## 5. Proposed API endpoints (first step only)

The minimal set needed to support the initial frontend migration. Session browsing and deletion come later.

| Method | Path | Purpose |
|---|---|---|
| `POST /sessions` | Create a new session; return `{ id, title, created_at }` |
| `GET /sessions/:id/messages` | Return all messages for a session as `{ messages: [...] }` |
| `POST /sessions/:id/messages` | Append a single message; return `{ id }` |

Not needed yet (defer to session-list UI milestone):

- `GET /sessions` — list all sessions
- `DELETE /sessions/:id` — delete a session and all its messages
- `PATCH /sessions/:id` — rename a session

---

## 6. Migration path from localStorage

The goal is a gradual, zero-breakage transition. localStorage stays working throughout.

### Phase 1 — Write-through (next implementation step)

1. On `ChatPanel` mount, call `POST /sessions` to create (or retrieve) a default session.
   - Store the returned `session_id` in localStorage under key `jarvis.session.v1`.
   - If the backend is unreachable, skip silently — localStorage remains the source of truth.
2. After each successful `send()` completes (streaming ends, no error):
   - `POST /sessions/:id/messages` with the user message (`role: "user"`).
   - `POST /sessions/:id/messages` with the assistant message (`role: "assistant"`, `model: modelName`).
   - Both requests are fire-and-forget; failures are logged to console, not shown to the user.
3. localStorage continues to hold UI state and is the hydration source on page load.

This phase makes the backend a write-only mirror. No UI change is visible to the user.

### Phase 2 — Read from backend (later)

1. On mount, call `GET /sessions/:id/messages` to load history from the backend.
2. If the request succeeds, use backend data as the source of truth (replaces localStorage load).
3. localStorage becomes a cache: still written, used as a fallback when the API is unreachable.

### Phase 3 — Session list (later)

1. Add a session list to the left sidebar.
2. `GET /sessions` to list all sessions.
3. Clicking a session loads it via `GET /sessions/:id/messages`.
4. "New Chat" button calls `POST /sessions` and sets the new session as active.
5. Delete session button calls `DELETE /sessions/:id` with confirmation.

---

## 7. Safety checklist

| Rule | Status |
|---|---|
| No cloud AI providers | ✓ SQLite is local-only |
| No secrets stored in database | ✓ Only chat content (user-visible) |
| No committing database files | ✓ Covered by `.gitignore` |
| No autonomous file writing | ✓ Only chat_messages, not project files |
| No autonomous agent behavior | ✓ Pure storage, no decision-making |
| Data stays on the user's machine | ✓ `data/memory/` is local, not synced |

---

## 8. Risks and open questions

1. **Native build failure on Windows**: `better-sqlite3` requires C++ build tools. Must verify this works before committing to the package. Test with `npm install better-sqlite3` in `apps/api` and confirm it compiles. Fallback: `sql.js`.

2. **Session ID lifecycle**: If the user clears localStorage (or uses a private window), `jarvis.session.v1` is gone. The frontend will call `POST /sessions` again and get a new session ID. Old sessions remain in the database but become orphaned from the UI. Acceptable for now; session list UI will make them recoverable later.

3. **Concurrent writes**: This is a single-user local app. SQLite handles single-writer workloads well. No connection pooling needed.

4. **Schema migrations**: Once data is on disk, changing the schema requires a migration. Starting simple (two tables, no JSON blobs) minimizes this risk. If a column needs to be added later, a simple `ALTER TABLE ... ADD COLUMN` is sufficient.

5. **Error and cancelled messages**: Storing `error` and `cancelled` role messages in the database is useful for audit/replay but adds noise to history. The `buildHistory()` function already filters them out before sending to Ollama — the same filter should apply when reading from the database.

---

## 9. What is NOT in scope

- Full-text search over chat history (v0.3 memory feature).
- Exporting chat history.
- Sharing sessions across machines.
- User authentication or access control.
- Attaching files or tool outputs to messages.
- Auto-generating session titles (nice-to-have, not required for Phase 1).

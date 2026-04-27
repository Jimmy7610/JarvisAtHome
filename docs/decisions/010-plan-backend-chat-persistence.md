# Decision 010 — Plan: Backend Chat Persistence

**Date:** 2026-04-27  
**Status:** Planning (not yet implemented)

## Context

Chat history is currently stored only in the browser's `localStorage`. This means:

- History is tied to one browser on one machine.
- It will eventually hit the ~5 MB storage cap.
- The backend cannot access or act on past conversations.
- Future memory features (v0.3) require server-side storage.

## Decision

Adopt SQLite for local server-side chat persistence using the `better-sqlite3` package.

This keeps all data local (no cloud), requires no external database process, and fits the existing local-first architecture.

The full architecture plan lives at:

```
docs/architecture/backend-chat-persistence-plan.md
```

## Key choices

### SQLite over alternatives

| Option | Verdict |
|---|---|
| `localStorage` only | Insufficient for multi-session / multi-device / memory features |
| PostgreSQL / MySQL | Overkill — requires a running database server process |
| Flat JSON files | No query capability; hard to maintain consistency |
| SQLite (`better-sqlite3`) | ✓ Local file, fast, no server, good TS support |

### Schema (two tables)

`chat_sessions` — one row per conversation.  
`chat_messages` — one row per message, foreign-keyed to a session with `ON DELETE CASCADE`.

See `docs/architecture/backend-chat-persistence-plan.md` for full DDL.

### Storage path

```
data/memory/jarvis.sqlite
```

Configurable via `JARVIS_DB_PATH` environment variable.  
Already gitignored by both `data/memory/` and `*.sqlite` rules in `.gitignore`.

### Migration strategy

Gradual, three-phase. Phase 1 (write-through) requires no visible UI change:

1. Frontend creates/retrieves a session on mount via `POST /sessions`.
2. After each successful send, messages are written to the backend as fire-and-forget.
3. localStorage remains the source of truth for UI state — backend is a write-only mirror.

Phases 2 and 3 add backend reads and the session list sidebar respectively.

### Minimum API surface (Phase 1 only)

- `POST /sessions` — create a session, return ID
- `GET /sessions/:id/messages` — load messages (Phase 2)
- `POST /sessions/:id/messages` — append a message

## What this decision does NOT include

- Installing any package.
- Creating the database file.
- Adding any API routes.
- Changing any UI behavior.
- Changing localStorage behavior.

Implementation begins in a subsequent task.

## Risks

1. `better-sqlite3` requires native C++ build tools on Windows. Must verify compilation before committing to the package.
2. Schema migrations will be needed for future columns — starting minimal reduces this risk.
3. Orphaned sessions if localStorage is cleared (recoverable when session list UI is added).

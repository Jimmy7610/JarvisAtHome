# Decision 058 - Memory Foundation (v0.9.0)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

Jarvis previously had no memory layer.  Every conversation started from scratch —
past preferences, project notes, and recurring context had to be re-stated each
time.  This milestone adds a safe foundation: the user can manually store notes
in a local SQLite table.

## Safety constraints (non-negotiable for v0.9.0)

| Constraint | Status |
|---|---|
| Memory written only by explicit user action | ✅ enforced |
| AI/model cannot write memory | ✅ no `/memory` POST from chat path |
| Memory NOT injected into Ollama system prompt | ✅ chat routes unchanged |
| Memory NOT sent to cloud services | ✅ local SQLite only |
| Content not logged to console | ✅ only title logged in activity events |

Automatic injection is deferred to a later milestone where the user can opt in.

## Data storage

Reuses the existing `better-sqlite3` singleton in `apps/api/src/services/db.ts`.
No second database, no new npm dependency.

New table added to the existing `db.exec` block:

```sql
CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,           -- UUID, generated server-side
  type       TEXT NOT NULL CHECK(type IN ('preference', 'project', 'note')),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
```

Allowed types: `preference`, `project`, `note`.

## Backend API — `apps/api/src/routes/memory.ts`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/memory` | List all memories, newest first |
| `POST` | `/memory` | Create a new memory (user-initiated only) |
| `DELETE` | `/memory/:id` | Delete a memory by UUID |

Validation:
- `type` must be one of the three allowed values (rejected otherwise)
- `title`: required, trimmed, max 200 chars
- `content`: required, trimmed, max 2 000 chars
- `id` for delete: checked against DB before deletion

The `POST /memory` route has a comment at the top explicitly marking it as
user-only.  There is no code path from the chat or Ollama stream routes to
`/memory`.

## Frontend — `MemoryPanel.tsx`

A new component (`apps/web/src/components/MemoryPanel.tsx`) with:
- "Add memory" toggle form with type selector, title, and content
- Search/filter input (client-side, matches title + content + type)
- Memory list with type badge (purple/cyan/blue), title, content, timestamp
- Delete button behind `window.confirm()`
- Empty state, loading state, error + retry
- Activity log events: `Memory added: <title>` and `Memory deleted: <title>`
  (content is never logged)
- Footer note: "Memory is manual-only in v0.9.0 · stored in local SQLite · not sent to Ollama or any cloud service"

## Navigation

`page.tsx` view state extended from `"chat" | "settings"` to
`"chat" | "memory" | "settings"`.  The previously-disabled Memory nav item
now calls `setView("memory")`.  All three views are peer-level siblings;
the right sidebar remains visible in all views.

## Settings panel update

A new **Memory** card is added to `SettingsPanel.tsx` showing:
- Storage: local SQLite
- Memory types
- Auto memory injection: disabled
- Autonomous memory writing: disabled
- Manual add/delete: enabled
- Sent to Ollama or cloud: never

Feature Status card updated: Memory (manual, local SQLite) → `done`.

## What this is NOT

- Memory is not searched during chat
- Memory is not injected into the Ollama system prompt
- There is no RAG, no semantic search, no vector database
- The AI cannot add, edit, or delete memories

## Files changed

| File | Change |
|---|---|
| `apps/api/src/services/db.ts` | `memories` table + index added to existing schema |
| `apps/api/src/routes/memory.ts` | **New** — GET/POST/DELETE endpoints |
| `apps/api/src/index.ts` | Import + register memoryRouter at /memory |
| `apps/api/src/routes/settings.ts` | `appVersion` bumped to `"0.9.0"` |
| `apps/web/src/components/MemoryPanel.tsx` | **New** — full memory UI |
| `apps/web/src/app/page.tsx` | `"memory"` added to view state; Memory nav item wired; center section updated; version string |
| `apps/web/src/components/SettingsPanel.tsx` | Memory card added; Feature Status updated; footer version |
| `docs/decisions/058-memory-foundation.md` | This document |
| `README.md` | Version bumped to v0.9.0; feature bullet added |

## What is NOT changed

All chat, streaming, model selector, write approval, workspace, project library, TTS, and right sidebar features are unchanged.  JarvisBrain repository untouched.

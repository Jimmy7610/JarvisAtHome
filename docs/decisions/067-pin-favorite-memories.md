# Decision 067 — Pin/Favorite Memories (v1.1.2)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

As the memory list grows, some notes are more important than others. Without
a way to mark them, important notes get buried below newer entries. v1.1.2
adds a manual pin/favorite flag so the user can surface key notes instantly.

## Safety contract

- Pinned is a **manual organisation flag** only.
- Pinning a note does NOT automatically include it in chat context.
- "In this chat" remains a completely separate explicit opt-in.
- The model cannot pin, unpin, or read pin state autonomously.
- No autonomous memory writes of any kind.

## Database migration

The `memories` table already exists from v0.9.0. SQLite's `ALTER TABLE`
is used to add the new column safely. SQLite does not support
`ADD COLUMN IF NOT EXISTS` before 3.35.0, so the migration catches the
`"duplicate column name"` error that SQLite throws on a repeated run:

```typescript
try {
  db.exec(
    "ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"
  );
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.includes("duplicate column name")) throw e;
  // Expected on every startup after the first migration — no-op
}
```

- **New column:** `pinned INTEGER NOT NULL DEFAULT 0`
- **Default:** all existing notes start unpinned (`0`)
- **No data loss:** existing rows are preserved unchanged
- **Idempotent:** safe to run at every startup

## Backend

### `MemoryRow` type update

`pinned: number` (0 | 1) added to the shared row type. All `SELECT` and
`RETURNING` clauses updated to include `pinned`.

### GET /memory

`ORDER BY` updated to `pinned DESC, created_at DESC` — pinned notes are
returned first, then newest-first within each group.

### POST /memory

`RETURNING` updated to include `pinned` (always 0 for new notes).

### PATCH /memory/:id

`RETURNING` updated to include `pinned`; editing a note does not change its
pinned state (the `SET` clause does not touch `pinned`).

### New: PATCH /memory/:id/pinned

Dedicated endpoint for toggling pin state.

- **Route placement:** registered **before** `PATCH /:id` so Express does not
  interpret the literal `"pinned"` path segment as the `:id` parameter.
- **Body:** `{ pinned: boolean }`
- **Validation:** `pinned` must be a boolean; 404 if memory not found
- `updated_at` is refreshed on every pin toggle
- Returns `{ ok: true, memory: MemoryRow }`
- Does not log content

## Frontend — MemoryPanel

### New types and helpers

```typescript
// pinned stored as boolean in the frontend
interface MemoryItem { ...; pinned: boolean; }

// Raw API shape — SQLite returns 0|1
type MemoryApiRow = Omit<MemoryItem, "pinned"> & { pinned: number };

// Convert at the fetch boundary
function fromApiRow(row: MemoryApiRow): MemoryItem {
  return { ...row, pinned: row.pinned === 1 };
}

// Sort: pinned first, then newest-first within each group
function sortMemories(list: MemoryItem[]): MemoryItem[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
    return a.created_at < b.created_at ? 1 : -1;
  });
}
```

`fromApiRow` and `sortMemories` are called after every state update
(load, add, edit, pin toggle) so the list stays consistently sorted without
requiring a full refetch on every change.

### handlePinToggle

Calls `PATCH /memory/:id/pinned`, updates local state with the returned row,
re-sorts the list, and emits an Activity Log event (`Memory pinned: <title>` /
`Memory unpinned: <title>`). Pin toggle is non-fatal — a failure logs a
`console.warn` but does not show an error in the UI.

Pin toggle does **not** call `onMemoryUpdated` — pin state is not part of
`MemoryContextItem` and does not affect chat context injection.

### Card UI

| State | Card border | Card background |
|---|---|---|
| Normal | `border-slate-700/60` | `bg-slate-800/30` |
| Pinned | `border-amber-500/30` | `bg-amber-500/5` |
| Editing | `border-cyan-500/30` | `bg-slate-800/50` |

Pin button (in read view, before "In this chat"):

| State | Label | Style |
|---|---|---|
| Unpinned | `☆ Pin` | `text-slate-600 hover:text-amber-400` |
| Pinned | `★ Pinned` | `text-amber-400 hover:text-amber-300` |

Title attribute: `"Pin this memory (does not add to chat)"` / `"Unpin this memory"`.

### Sorting within filters/search

`displayMemories` is derived from `typeFilteredMemories → search query`.
Because `memories` state is always kept sorted (pinned first), the derived
`displayMemories` naturally shows pinned items first within any active filter
or search result — no extra sort step needed.

## What is NOT changed

- "In this chat" toggle — completely independent from pin
- `selectedMemoryContext` in page.tsx — pin state is not part of MemoryContextItem
- Per-session localStorage (stores IDs only, no pin state)
- Memory nav badge
- All other memory operations (add/edit/delete/search/filter)
- JarvisBrain — untouched

## Files changed

| File | Change |
|---|---|
| `apps/api/src/services/db.ts` | Safe `ALTER TABLE` migration for `pinned` column |
| `apps/api/src/routes/memory.ts` | `MemoryRow` type; `pinned` in all SELECT/RETURNING; new `PATCH /:id/pinned`; GET ORDER BY updated |
| `apps/web/src/components/MemoryPanel.tsx` | `pinned: boolean` in `MemoryItem`; `MemoryApiRow` type; `fromApiRow` + `sortMemories` helpers; updated load/add/edit state setters; `handlePinToggle`; pin button in card; amber pinned card border |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.1.2"` |
| `apps/web/src/app/page.tsx` | sidebar footer |
| `apps/web/src/components/SettingsPanel.tsx` | Feature Status row; Memory card row; footer fallback `"1.1.2"` |
| `README.md` | heading → v1.1.2; pin/favorite feature bullet |
| `docs/decisions/067-pin-favorite-memories.md` | This document |

# Decision 060 — Persist Selected Memory Context (v0.9.2)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.9.1 added memory opt-in chat context (Include toggles per note), but the
selection was held only in React state and was lost on every browser refresh.

v0.9.2 persists the selected memory IDs to `localStorage` so the user's
chat context selection survives page reloads.

## Design constraints

| Constraint | Decision |
|---|---|
| Do not store memory content in localStorage | Only UUIDs are stored |
| Do not write selection state to the backend | Frontend localStorage only |
| Do not add autonomous memory injection | Still explicit user opt-in only |
| Do not add new API endpoints | Reuse existing `GET /memory` for restore |
| Clean up stale IDs from deleted memories | Handled on restore and on delete |

## localStorage key

```
jarvis:selected-memory-context-ids
```

Format: JSON array of UUID strings.  
Example: `["a1b2c3d4-...", "e5f6g7h8-..."]`

Content is **never** stored in `localStorage` — only UUIDs.

## State ownership (unchanged from v0.9.1)

`selectedMemoryContext: MemoryContextItem[]` continues to live in `page.tsx`.

The three new module-level helpers are also in `page.tsx`:
- `readStoredMemoryContextIds()` — reads and validates from localStorage
- `writeStoredMemoryContextIds(ids)` — writes the current UUID list
- `clearStoredMemoryContextIds()` — removes the key

## Restore flow on page load

Because `MemoryPanel` is only mounted when `view === "memory"`, it cannot be
used as the source for restore. `page.tsx` runs a dedicated restore effect:

```
Mount effect (runs once, client-side only):
  1. Read saved IDs from localStorage
  2. If none, exit early (skip fetch)
  3. Fetch GET /memory
  4. Filter response to memories whose IDs match saved set
  5. Call setSelectedMemoryContext(restored)
  6. If any saved IDs were not found (deleted memories): write back cleaned list
     or remove key if empty
```

The restore effect is **silent** — no Activity Log event is emitted.  
If the API is unreachable, selection starts empty; saved IDs are preserved for
the next page load.

## Write flow on toggle

```
handleMemoryContextToggle(item):
  Inside setSelectedMemoryContext updater:
    Compute next list (add or remove item)
    if next.length === 0: clearStoredMemoryContextIds()
    else: writeStoredMemoryContextIds(next.map(m => m.id))
    return next
  Outside updater: handleActivity(...) [existing behaviour]
```

## Write flow on clear

```
handleMemoryContextClear():
  setSelectedMemoryContext([])
  clearStoredMemoryContextIds()
  handleActivity("Memory context cleared", "info")
```

## Delete flow (immediate cleanup)

A new `onMemoryDeleted(id)` prop on `MemoryPanel` fires after a successful
`DELETE /memory/:id` response. `page.tsx` handles it via `handleMemoryDeleted`:

```
handleMemoryDeleted(id):
  Inside setSelectedMemoryContext updater:
    Compute next = prev.filter(m => m.id !== id)
    If next.length changed (note was selected):
      if next.length === 0: clearStoredMemoryContextIds()
      else: writeStoredMemoryContextIds(next.map(m => m.id))
    return next
```

No Activity Log event — the delete event is already logged by MemoryPanel.

## Activity Log behaviour

| Action | Event |
|---|---|
| Toggle include | `Memory included in context: <title>` |
| Toggle remove | `Memory removed from context: <title>` |
| Clear all | `Memory context cleared` |
| Delete selected memory | No extra event (delete already logged) |
| Page load restore | **Silent — no event** |

## Safety summary

| Safety rule | Status |
|---|---|
| Only user-toggled notes are injected | ✅ unchanged |
| AI cannot read/write/select memories | ✅ unchanged |
| Content never stored in localStorage | ✅ only UUIDs stored |
| Content never sent to cloud | ✅ Ollama only |
| Selection not written to backend | ✅ localStorage only |
| Stale IDs cleaned up | ✅ on restore and on delete |

## Files changed

| File | Change |
|---|---|
| `apps/api/src/routes/settings.ts` | `appVersion` bumped to `"0.9.2"` |
| `apps/web/src/app/page.tsx` | `MEMORY_CONTEXT_IDS_KEY` constant; `readStoredMemoryContextIds`, `writeStoredMemoryContextIds`, `clearStoredMemoryContextIds` helpers; restore effect on mount; localStorage writes in `handleMemoryContextToggle` and `handleMemoryContextClear`; new `handleMemoryDeleted`; `onMemoryDeleted` prop passed to MemoryPanel; sidebar footer version |
| `apps/web/src/components/MemoryPanel.tsx` | `onMemoryDeleted` prop added; called after successful DELETE |
| `apps/web/src/components/SettingsPanel.tsx` | Footer fallback version bumped |
| `docs/decisions/060-persist-selected-memory-context.md` | This document |
| `README.md` | Version bumped to v0.9.2; feature bullet added |

## What is NOT changed

All chat, streaming, model selector, write approval, workspace, project library,
TTS, right sidebar, memory add/delete, and memory search features are unchanged.
JarvisBrain repository untouched.

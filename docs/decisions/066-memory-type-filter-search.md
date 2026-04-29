# Decision 066 — Memory Type Filter and Improved Search (v1.1.1)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

As the memory list grows, users need a way to quickly narrow to a specific
type of note or to find notes by content. v1.1.0 added edit support but the
search was title/content-only and there was no type filter.

v1.1.1 adds:
- A compact filter pill bar (All / Preferences / Projects / Notes / In this chat)
- Combined filter + search (type filter applied first, then search query)
- Per-filter counts on filter pills
- A result summary line
- A "Clear filters" single-click reset
- Context-aware empty states

## Design

### Filter state

Local component state only — not persisted, resets on page reload:

```typescript
type TypeFilter = "all" | "preference" | "project" | "note" | "in-chat";
const [activeTypeFilter, setActiveTypeFilter] = useState<TypeFilter>("all");
```

### Combined filtering logic

Two-step pipeline, computed inline (no extra useEffect):

```
typeFilteredMemories = apply activeTypeFilter on memories
displayMemories      = apply trimmedQuery on typeFilteredMemories
```

`in-chat` filter uses `selectedMemoryIds.has(m.id)` — the same Set passed in
from `page.tsx`.

Search query is case-insensitive and matches `title`, `content`, and `type`.
Trimming is applied before comparison.

### Filter counts

Always computed from the full `memories` array (not from the filtered list),
so counts stay stable while the user changes filters:

```typescript
const filterCounts: Record<TypeFilter, number> = {
  all: memories.length,
  preference: memories.filter(m => m.type === "preference").length,
  project:    memories.filter(m => m.type === "project").length,
  note:       memories.filter(m => m.type === "note").length,
  "in-chat":  memories.filter(m => selectedMemoryIds.has(m.id)).length,
};
```

### UI layout

```
[ All 8 ] [ Preferences 2 ] [ Projects 3 ] [ Notes 3 ] [ In this chat 1 ]
[ Search title, content, or type… ]                       [ Clear filters ]
  Showing 3 of 8 memories
```

The filter bar wraps on narrow screens (`flex-wrap`).

Active filter styles match the existing type badge palette:
- All: slate background
- Preferences: purple
- Projects: cyan
- Notes: blue
- In this chat: purple (matches the existing purple context chip)

### Result summary

- No filter/search active: `N memory / memories`
- Filter/search active and results found: `Showing N of M memories`
- Filter/search active, no results: inline summary shows `No matching memories`

### Context-aware empty states

When `displayMemories.length === 0` and `memories.length > 0`:

| Filter | Query | Message |
|---|---|---|
| in-chat | empty | "No memories are selected for this chat." |
| in-chat | set | `No selected memories match "…".` |
| preference/project/note | empty | `No ${type} memories yet.` |
| preference/project/note | set | `No ${type} memories match "…".` |
| all | set | `No memories match "…".` |

A "Clear filters" button appears below every context-aware empty state.

### "Clear filters" button

Shown when `activeTypeFilter !== "all" || trimmedQuery !== ""`. Calls
`handleClearFilters()` which resets both state values in one click.

## Effect on existing operations

- **Include/uninclude**: works on filtered results; `selectedMemoryIds` Set
  updates `filterCounts["in-chat"]` reactively
- **Edit**: works on filtered results; after save the note is updated in
  `memories` and `displayMemories` recomputes — if the updated note no longer
  matches the active filter/search it may disappear (acceptable)
- **Delete**: works on filtered results; `memories` updates and counts recompute
- **Add**: new note is prepended to `memories`; it appears if it matches the
  active filter/search

## Version string changes

| Location | Before | After |
|---|---|---|
| `apps/api/src/routes/settings.ts` `appVersion` | `"1.1.0"` | `"1.1.1"` |
| `apps/web/src/app/page.tsx` sidebar footer | `v1.1.0 — edit memory notes` | `v1.1.1 — memory filter and search` |
| `apps/web/src/components/SettingsPanel.tsx` footer fallback | `"1.1.0"` | `"1.1.1"` |
| `README.md` feature section heading | `(v1.1.0)` | `(v1.1.1)` |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/MemoryPanel.tsx` | `TypeFilter` type; `activeTypeFilter` state; `typeFilteredMemories`/`displayMemories`/`filterCounts`/`isFiltered`; `handleClearFilters`; filter pill bar; search row; result summary; context-aware empty state |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.1.1"` |
| `apps/web/src/app/page.tsx` | sidebar footer |
| `apps/web/src/components/SettingsPanel.tsx` | Feature Status row; Memory card search/filter row; footer fallback |
| `README.md` | heading → v1.1.1; feature bullet added |
| `docs/decisions/066-memory-type-filter-search.md` | This document |

## What is NOT changed

- Memory add/edit/delete
- Memory opt-in chat context (include/uninclude)
- Per-chat context scoping
- Per-session localStorage persistence
- Memory nav badge
- Memory stats in Settings
- All backend routes — unchanged
- JarvisBrain — untouched

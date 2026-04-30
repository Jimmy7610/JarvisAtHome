# Decision 069 — Memory Cleanup / Duplicate Detection (v1.1.4)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

As the memory list grows, the user may accidentally create duplicate or
near-duplicate notes (especially after repeated imports).  v1.1.4 adds a
lightweight advisory tool that surfaces likely duplicates so the user can
clean them up manually.

## Safety contract

- **Frontend-only** — no backend endpoint added, no database read initiated.
- **Read-only** — no memory records are created, modified, or deleted.
- **No AI involvement** — detection is deterministic string comparison.
- **Manual action required** — the panel only suggests; the user decides.
- **No content logged** — only the group count goes to the Activity Log.

## Detection algorithm

All logic lives in three pure, module-level functions in `MemoryPanel.tsx`.

### `normalizeText(s: string): string`

```typescript
s.trim().toLowerCase()
 .replace(/\s+/g, " ")          // collapse whitespace
 .replace(/([!?,;:.])\1+/g, "$1") // collapse repeated identical punctuation
```

Produces a canonical form used for comparison — the original strings in the
database are never modified.

### `findDuplicateGroups(list: MemoryItem[]): DuplicateGroup[]`

Two passes over the in-memory `memories` array (not the filtered/searched view):

**Pass A — Exact duplicates**
Groups by `"${type}|${normalTitle}|${normalContent}"`.
Any group with ≥ 2 members → `DuplicateGroup { kind: "exact", members }`.

**Pass B — Same-title candidates**
Groups by `"${type}|${normalTitle}"`.
Any group with ≥ 2 members AND ≥ 2 distinct normalised content values →
`DuplicateGroup { kind: "title-match", members }`.

A note may appear in both a `"exact"` group and a `"title-match"` group if it
has exact duplicates AND also shares a title with other notes that have
different content.

### `contentPreview(s: string, maxLen = 80): string`

Truncates content to 80 characters with a `…` suffix for compact display in
the duplicate panel.  Only shown for `"title-match"` groups — exact groups
all have identical content so the preview adds no information.

## UI

### Trigger button

A **Find duplicates** button is added to the header action row alongside
Export and Import.  The button is disabled (`memories.length < 2`) when
there cannot be duplicates.  While the panel is open the button has a
subtle active style; clicking it re-runs the analysis.

### Duplicate panel

Appears below the import panels and above the chat context summary.

| Element | Description |
|---|---|
| Panel header | "DUPLICATE CHECK — N groups found" + Close button |
| Safety notice | Always visible: "Suggestions only — nothing is changed automatically." |
| No groups | "No likely duplicates found." |
| Group kind label | "Exact duplicate — N notes with identical type, title, and content" or "Same title — N notes with the same type and title but different content" |
| Member row | TypeBadge + title truncated; content preview for title-match groups only |
| Click a member row | Sets `searchQuery` to the note's title and closes the panel → the main list shows matching cards |

No delete or edit buttons inside the panel — the user uses the existing
Memory card controls (Edit, Delete) in the main list.

## Activity Log

One event per analysis run, count only:

```
Memory duplicate check: 2 groups found
```

No titles or content are ever logged.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/MemoryPanel.tsx` | `normalizeText`, `contentPreview`, `DuplicateGroupKind`, `DuplicateGroup`, `findDuplicateGroups` (module level); `dupPanelOpen` + `dupGroups` state; `handleFindDuplicates`; "Find duplicates" button in header; duplicate panel in render |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.1.4"` |
| `apps/web/src/app/page.tsx` | sidebar footer |
| `apps/web/src/components/SettingsPanel.tsx` | Duplicate detection row in Memory card; Memory cleanup / duplicate detection in Feature Status; version fallbacks |
| `README.md` | heading → v1.1.4; duplicate detection feature bullet |
| `docs/decisions/069-memory-cleanup-duplicate-detection.md` | This document |

## What is NOT changed

- No backend endpoints added
- No database schema changes
- No automatic memory edits or deletions
- All existing memory operations (add/edit/delete/pin/export/import/search/filter/context)
- JarvisBrain — untouched

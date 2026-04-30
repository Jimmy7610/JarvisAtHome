# Decision 068 — Memory Export/Import (v1.1.3)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

As the memory list grows, users need a way to back up their notes and move
them between machines.  v1.1.3 adds a manual export/import flow — entirely
user-initiated, with no autonomous AI involvement at any point.

## Safety contract

- Export and import are **manual user actions only**.
- The model cannot trigger export or import.
- Imported memories are NOT automatically included in any chat context.
- "In this chat" remains a completely separate explicit opt-in.
- Database IDs in an import file are silently ignored — fresh UUIDs are
  generated server-side.
- Raw memory content is never logged on the server or client.
- No chat history, localStorage keys, or session data are included in exports.

## Export format

The downloaded file is a standalone JSON document:

```json
{
  "format": "jarvis-memory-export",
  "version": 1,
  "exportedAt": "2026-04-30T12:00:00.000Z",
  "memories": [
    {
      "type": "preference",
      "title": "...",
      "content": "...",
      "pinned": true
    }
  ]
}
```

**Excluded from the file:**
- Database IDs
- `created_at` / `updated_at`
- Selected-for-chat context (localStorage)
- Chat history
- Any other personal or session data

`pinned` is included so a round-trip export → import preserves the user's
pin organisation.

## Backend

### GET /memory/export

- Registered before `GET /` (future-safe ordering).
- Selects `type, title, content, pinned` — no `id`, no timestamps.
- Converts `pinned` INTEGER (0/1) to boolean.
- Returns `{ ok: true, export: ExportPayload }`.
- The frontend downloads only the inner `export` object as a file.

### POST /memory/import

- Validates envelope: `format === "jarvis-memory-export"`, `version === 1`,
  `memories` is an array.
- Per-item validation: `type` in allowed set, `title` non-empty (≤ 200),
  `content` non-empty (≤ 2000), `pinned` boolean (optional, defaults false).
- Duplicate detection: loads all existing rows once, builds a `Set<string>`
  of `"${type}|${normalTitle}|${normalContent}"` keys (trimmed, lowercased).
  Within-file duplicates are also caught by adding each accepted key to the
  set before inserting.
- Statement is prepared once outside the loop for efficiency.
- Returns `{ ok: true, imported, skippedDuplicates, invalid, memories }`.
- `imported` is the count of rows actually written; `skippedDuplicates` and
  `invalid` explain items that were not written.

## Frontend — MemoryPanel

### Export flow

1. User clicks **Export** → `handleExport()` is called.
2. `GET /memory/export` is fetched.
3. The inner `export` object is serialised to a `Blob` (pretty-printed JSON).
4. A temporary `<a>` element triggers a browser download.
5. Filename: `jarvis-memory-export-YYYY-MM-DD.json`.
6. Activity Log event: `Memory export downloaded`.
7. On error: `Memory export failed` (error type).

### Import flow

1. User clicks **Import** → hidden `<input type="file">` is clicked via ref.
2. User selects a `.json` file.
3. `FileReader` reads the file as text; client-side validation checks
   `format`, `version`, and that `memories` is an array.
4. On parse failure: inline error panel with Dismiss.
5. On success: **preview panel** shows:
   - File name
   - Memory count with type breakdown (e.g. `2 preference, 1 note`)
   - Safety notice: importing does not add notes to chat
6. User clicks **Confirm import** → `POST /memory/import`.
7. On success: result panel shows `imported · skipped · invalid` counts.
8. Activity Log event: `Memory import completed: X imported, Y duplicates skipped`.
9. `loadMemories()` is called to refresh the list.
10. **No `onMemoryUpdated` or `onToggleMemoryContext` is called** — import
    does not touch the chat context selection.

### State management

| State variable | Purpose |
|---|---|
| `exporting: boolean` | Export loading indicator |
| `fileInputRef` | Ref to hidden `<input type="file">` |
| `importPreview` | Parsed file data shown in preview panel |
| `importing: boolean` | POST in-flight indicator |
| `importResult` | Summary counts shown after a successful import |
| `importError` | Error message from parse or API failure |

`resetImport()` clears all import state and resets the file input value so
the same file can be re-selected after a cancel or dismiss.

### UI — header buttons

The page header now has two rows on the right:
1. `+ Add memory` (existing)
2. `Export` · `Import` (new, smaller secondary buttons)

The hidden `<input type="file" accept=".json,application/json">` is rendered
in the DOM alongside these buttons with `aria-hidden="true"`.

### Import panels

Three conditional panels appear below the page header and above the
context-selection summary:

| Condition | Panel style | Content |
|---|---|---|
| `importError` | Red border | Error message + Dismiss |
| `importPreview` | Amber border | File name, count, type breakdown, safety note, Confirm/Cancel |
| `importResult` | Emerald border | imported / skipped / invalid counts + Dismiss |

## What is NOT changed

- "In this chat" toggle — completely independent from import
- `selectedMemoryContext` in page.tsx — import never touches it
- Per-session localStorage — unchanged
- Memory nav badge — updated automatically via `loadMemories()` callback
- All other memory operations (add/edit/delete/pin/search/filter)
- JarvisBrain — untouched

## Files changed

| File | Change |
|---|---|
| `apps/api/src/routes/memory.ts` | `GET /export`; `POST /import`; route comment updated |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.1.3"` |
| `apps/web/src/components/MemoryPanel.tsx` | `useRef` import; `ExportMemoryEntry` + `ExportPayload` types; export/import state; `handleExport`, `handleFileSelect`, `handleImportConfirm`, `resetImport`; Export/Import buttons in header; import panels |
| `apps/web/src/app/page.tsx` | sidebar footer |
| `apps/web/src/components/SettingsPanel.tsx` | Export/import row in Memory card; Memory export/import in Feature Status; version fallbacks |
| `README.md` | heading → v1.1.3; export/import feature bullet |
| `docs/decisions/068-memory-export-import.md` | This document |

# Decision 065 — Edit Memory Notes (v1.1.0)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

v0.9.0 introduced manual memory add/delete. v0.9.1 added opt-in chat context
injection. v1.0.0 added per-chat context scoping.

There was no way to fix a typo or update the content of a memory note — the
only option was to delete and re-create it, losing the note's inclusion state
across chats.

v1.1.0 adds manual inline editing of existing memory notes.

## Safety contract

- Memory editing is user-initiated only. There is no AI path to `PATCH /memory/:id`.
- The model cannot write, edit, or delete memory autonomously.
- The same validation rules apply as for creating a note (type, title, content).
- Memory content is not logged anywhere in the server-side handler.
- No cloud services involved.

## Backend — PATCH /memory/:id

New endpoint added to `apps/api/src/routes/memory.ts`.

**Request body:**
```json
{ "type": "preference|project|note", "title": "…", "content": "…" }
```

**Validation:**
- `id` must be a non-empty string (from route param)
- `type` must be one of `preference | project | note`
- `title` must be a non-empty string, trimmed, max 200 chars
- `content` must be a non-empty string, trimmed, max 2000 chars

**Behaviour:**
- If the memory does not exist: returns `404` with `{ ok: false, error: "Memory not found." }`
- On success: updates the row and returns `{ ok: true, memory: MemoryRow }` with the updated `updated_at`
- Uses `RETURNING` so a single SQLite statement both updates and returns the result
- Content is never logged — only the id and title would be safe to log

**No backend route registration change required** — the router is already mounted
at `/memory` in `apps/api/src/index.ts`.

## Frontend — inline edit mode (MemoryPanel)

Each memory card gains an **Edit** button. Clicking it:

1. Closes any other open edit form (only one note editable at a time)
2. Opens an inline edit form inside the same card replacing the read view
3. Pre-fills type, title, and content from the current note values

The edit form contains:
- Type selector (same pill buttons as the add form)
- Title input (maxLength 200)
- Content textarea (maxLength 2000, 3 rows)
- Save button (disabled while saving, shows "Saving…")
- Cancel button (closes form, discards changes)
- Inline error message on API failure or client-side validation failure

On **Save**:
1. Client validates non-empty title and content before fetch
2. `PATCH /memory/:id` is called
3. On success: updates the note in the MemoryPanel local list, calls
   `onMemoryUpdated`, logs `Memory updated: <title>`, closes the edit form
4. On error: shows the API error message inline; form stays open

On **Cancel**: closes the edit form, no API call, no state change.

The card border changes to a cyan tint while editing to make the active edit
visually distinct.

### Timestamp display

In read mode, the card timestamp now shows:
- `Updated <date>` when `updated_at !== created_at`
- `<created_at date>` otherwise (unchanged from before)

## State update after edit — `onMemoryUpdated` callback

New prop added to `MemoryPanelProps`:

```typescript
onMemoryUpdated?: (item: MemoryContextItem) => void;
```

In `page.tsx`:

```typescript
function handleMemoryUpdated(updated: MemoryContextItem): void {
  setSelectedMemoryContext((prev) =>
    prev.map((m) => (m.id === updated.id ? updated : m))
  );
}
```

If the edited note is currently included in the active chat's memory context,
its entry in `selectedMemoryContext` is replaced with the updated object.
The next outgoing message will use the new title and content immediately.

localStorage is **not changed** — it stores only stable UUIDs, which do not
change when a note is edited.

## UI/wording changes

| Location | Change |
|---|---|
| Memory card (read view) | Added **Edit** button between "In this chat" and "Delete" |
| Memory card (edit view) | Inline form replaces the read view; card border goes cyan |
| Memory card timestamp | Shows "Updated …" when `updated_at ≠ created_at` |
| SettingsPanel Memory card | `Manual add/delete` → `Manual add/edit/delete` |
| SettingsPanel Feature Status | `Edit memory notes` — `✓ done` row added |
| SettingsPanel footer fallback | `"1.0.0"` → `"1.1.0"` |
| Sidebar footer | `v1.0.0 — stable release` → `v1.1.0 — edit memory notes` |
| `appVersion` in settings.ts | `"1.0.0"` → `"1.1.0"` |
| README feature heading | `(v1.0.0)` → `(v1.1.0)` |

## What is NOT changed

- Memory add/delete
- Memory search/filter
- Memory include/uninclude (toggle) per chat
- Per-chat memory context scoping
- Per-session localStorage persistence (IDs only)
- Memory nav badge
- Memory stats in Settings
- Chat, streaming, model selector
- Workspace Files, Project Library
- Write-with-approval, write proposals
- TTS controls
- JarvisBrain repository — untouched

## Files changed

| File | Change |
|---|---|
| `apps/api/src/routes/memory.ts` | Added `PATCH /memory/:id` endpoint; updated header comment |
| `apps/web/src/app/page.tsx` | Added `handleMemoryUpdated`; wired `onMemoryUpdated` to MemoryPanel; bumped sidebar footer |
| `apps/web/src/components/MemoryPanel.tsx` | Added `onMemoryUpdated` prop; edit state variables; `handleEditOpen/Cancel/Save` handlers; inline edit form in card render; updated timestamp display |
| `apps/web/src/components/SettingsPanel.tsx` | Feature Status: `Edit memory notes` done row; Memory card: `Manual add/edit/delete`; footer fallback `"1.1.0"` |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.1.0"` |
| `README.md` | Heading → v1.1.0; edit memory notes feature bullet added |
| `docs/decisions/065-edit-memory-notes.md` | This document |

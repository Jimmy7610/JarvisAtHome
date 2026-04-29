# Decision 062 — Memory Stats in Settings (v0.9.4)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

The Settings panel showed static memory capability flags but no live data.
After v0.9.3 (memory nav badge), `page.tsx` already holds:
- `memoryCount: number | null` — total notes from GET /memory on mount
- `selectedMemoryContext: MemoryContextItem[]` — current selected notes

v0.9.4 surfaces these values in the Settings → Memory card so the user can
see the current memory state without switching to the Memory view.

## Design decision: props vs. self-fetch

`SettingsPanel` receives the values as props from `page.tsx`:
- `memoryCount?: number | null`
- `selectedMemoryCount?: number`

This avoids an extra `GET /memory` fetch inside SettingsPanel, and keeps the
count immediately consistent with the nav badge (both read from the same
`page.tsx` state — no race or duplication).

`SettingsPanel` is and remains read-only. It does not write memory records,
write to the backend, or change any behaviour.

## Memory card — new rows

| Row | Value |
|---|---|
| Memory notes | live count from page.tsx (null → "—") |
| Selected for chat | live selected count; 0 shown dim; >0 shown in purple with "active" badge |
| Memory types | note · preference · project (static) |
| Content storage | local SQLite (static badge) |
| Selection storage | "localStorage IDs only" (static text) |
| Manual add/delete | enabled (static badge) |
| Manual context (opt-in) | enabled (static badge) |
| Persisted selection | enabled (static badge) |
| Auto injection | disabled (static badge) |
| Autonomous memory writes | disabled (static badge) |
| Sent to cloud | never (static badge) |

The live stat rows are at the top of the card so they are the first thing seen.

## Feature Status additions

Three milestones that were completed in v0.9.2–v0.9.3 but not listed in Feature
Status were added:
- Persistent memory selection (localStorage) — done
- Memory nav badge — done
- Memory stats in Settings — done

## Files changed

| File | Change |
|---|---|
| `apps/api/src/routes/settings.ts` | `appVersion` → `"0.9.4"` |
| `apps/web/src/app/page.tsx` | `memoryCount` and `selectedMemoryCount` props passed to SettingsPanel; sidebar footer version |
| `apps/web/src/components/SettingsPanel.tsx` | New `memoryCount` and `selectedMemoryCount` props; expanded Memory card; Feature Status additions; footer fallback version |
| `docs/decisions/062-memory-stats-in-settings.md` | This document |
| `README.md` | Version → v0.9.4; feature bullet added |

## What is NOT changed

- Memory add/delete, search, filter
- Memory opt-in context injection
- Persisted selected memory context
- Memory nav badge
- Chat streaming, model selector, write approval, workspace, project library,
  TTS, sessions, right sidebar tabs, Activity Log
- JarvisBrain repository untouched

# Decision 061 — Memory Nav Badge / Counter (v0.9.3)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

The Memory nav item in the left sidebar showed only the label "Memory" with no
indication of how many notes exist or how many are currently selected for chat
context. The user had to navigate into the Memory view to see this information.

v0.9.3 adds a small right-aligned badge to the Memory nav item that shows:
- The total number of memory notes (from SQLite via `GET /memory`)
- The number currently selected for chat context (from React state)

## Badge format

| State | Badge |
|---|---|
| Count not yet loaded | *(no badge)* |
| 0 notes | `0` |
| 4 notes, none active | `4` |
| 4 notes, 2 in chat context | `4 · 2✓` |

The `✓` indicator is compact and immediately legible alongside the count.

## Data flow

### Total count — two sources, one state variable (`memoryCount`)

**Source 1 — mount fetch (page.tsx):**  
The existing restore-IDs effect was unified into a single `GET /memory` fetch
that always runs on mount (previously it was skipped when no saved IDs existed).
This sets `memoryCount` immediately on page load, even if the user never visits
the Memory view during the session.

**Source 2 — MemoryPanel callback (`onMemoryCountChange`):**  
A new `useEffect` in `MemoryPanel` watches the `memories` list and fires
`onMemoryCountChange?.(memories.length)` whenever the list changes after loading
completes. This keeps the badge accurate during add/delete operations while the
user is in the Memory view.

The guard `if (!loading)` prevents the effect from reporting `0` for the initial
empty-array state before the fetch resolves, avoiding a brief count-flash.

### Selected count

`selectedMemoryContext.length` — already live in `page.tsx` state. No additional
data flow needed.

## NavItem changes

`NavItem` gained an optional `badge?: string` prop. When present, it renders
right-aligned inside the button using flex `justify-between`. Badge text uses
`text-slate-600` to keep it visually subordinate to the nav label in all states
(active cyan, inactive slate, disabled slate).

## What is NOT changed

- Memory add/delete behaviour
- Memory search/filter
- Memory opt-in context injection
- Persisted selected memory context (localStorage)
- Chat streaming, model selector, write approval, workspace, project library,
  TTS, sessions, right sidebar tabs, Activity Log

## Files changed

| File | Change |
|---|---|
| `apps/api/src/routes/settings.ts` | `appVersion` → `"0.9.3"` |
| `apps/web/src/app/page.tsx` | `memoryCount` state; unified mount fetch (count + restore); `handleMemoryCountChange`; `onMemoryCountChange` prop on MemoryPanel; `badge` prop on Memory NavItem; `NavItem` component extended with optional `badge` prop; sidebar footer version |
| `apps/web/src/components/MemoryPanel.tsx` | `onMemoryCountChange` prop; count-notify `useEffect`; stale footer version string cleaned up |
| `apps/web/src/components/SettingsPanel.tsx` | Footer fallback version bumped |
| `docs/decisions/061-memory-nav-badge.md` | This document |
| `README.md` | Version → v0.9.3; feature bullet added |

## What is NOT changed

JarvisBrain repository untouched.

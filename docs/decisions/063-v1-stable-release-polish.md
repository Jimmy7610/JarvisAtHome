# Decision 063 — v1.0.0 First Stable Release Polish

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

After v0.9.4 (memory stats in Settings), the Jarvis feature set reached a meaningful
stable point:

- Chat (streaming, sessions, history, model selector, active model indicator,
  per-message model stamp)
- Memory (manual add/delete, opt-in context injection, persistent selection,
  nav badge, settings stats)
- Workspace Files and Project Library (read-only browsers, file attachment,
  write-with-approval)
- Voice / TTS (mic input, browser TTS, local TTS foundation)
- Local email drafts (workspace/drafts/, write-with-approval)
- Settings panel (read-only, live Ollama status, memory stats)
- Safety model (Ollama-only, approval-gated writes, no autonomous behaviour)

v1.0.0 is a **documentation/status/wording pass only**.
No new runtime features, no API changes, no database schema changes.

## Changes made

### Version string bumps

| Location | Old | New |
|---|---|---|
| `apps/api/src/routes/settings.ts` `appVersion` | `"0.9.4"` | `"1.0.0"` |
| `apps/web/src/app/page.tsx` sidebar footer | `v0.9.4 — memory stats in settings` | `v1.0.0 — stable release` |
| `apps/web/src/components/SettingsPanel.tsx` footer fallback | `"0.9.4"` | `"1.0.0"` |
| `README.md` feature section heading | `(v0.9.4)` | `(v1.0.0)` |

### About Jarvis card (SettingsPanel)

A new first card — **About Jarvis** — was added before the Runtime card.
It shows:

- Identity: `Jarvis` + `v1.0.0` + `stable` badge
- One-line description (local-first, Ollama-only, no cloud)
- Summary safety rows: AI provider, Cloud AI, File writes, Memory injection,
  Project Library, Autonomous writes, Email sending

Design goal: a user opening Settings for the first time sees the full safety
model immediately, before any technical config rows.

The card is read-only (no new props, no new state, no backend calls).

### Feature Status additions (SettingsPanel)

Two done rows that were missing:

| Row | Status |
|---|---|
| Chat active model indicator (v0.8.2) | done |
| Per-message model stamp (v0.8.3) | done |

Four planned rows added to the planned section:

| Row |
|---|
| Full voice assistant |
| Real email integration |
| Multi-file proposals |
| Agent workflows |

### README additions

- v1.0.0 stable release bullet added at the end of the feature list.
- New **"What Jarvis does not do (by design)"** section added below the feature
  list. Documents: no cloud AI, no autonomous file writes, no automatic memory
  injection, no email sending, no terminal execution, no Home Assistant, and
  confirms no data leaves the machine.

## What is NOT changed

- Memory add/delete, search, filter, opt-in context, persistent selection,
  nav badge, settings stats
- Chat streaming, model selector, active model indicator, per-message stamp
- Write-with-approval safety model
- Workspace Files, Project Library, email drafts
- Voice / TTS controls and local TTS foundation
- Sessions, Activity Log, right sidebar tabs
- Backend routes, database schema, environment variables
- JarvisBrain repository untouched

## Files changed

| File | Change |
|---|---|
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.0.0"` |
| `apps/web/src/app/page.tsx` | sidebar footer version string |
| `apps/web/src/components/SettingsPanel.tsx` | About Jarvis card; Feature Status additions; footer fallback → `"1.0.0"` |
| `README.md` | heading → v1.0.0; v1.0.0 stable release bullet; "What Jarvis does not do" section |
| `docs/decisions/063-v1-stable-release-polish.md` | This document |

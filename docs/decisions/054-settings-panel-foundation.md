# Decision 054 - Settings Panel Foundation (v0.8.0)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

The left sidebar has always listed "Settings" as a nav item but it was
non-functional (no `onClick`, `disabled`-styled, not connected to anything).
By v0.7.5 the app had accumulated enough features — write approval, Project
Library, TTS, right sidebar tabs — that a real settings overview became
genuinely useful: the user can see at a glance what is enabled, what the
Ollama connection looks like, and what safety rules are active.

## Goal for v0.8.0

Read-only settings view only.  No editing, no `.env` writes, no secret
exposure.  This milestone plants the foundation so a later version can
add interactive settings on top of the same panel.

## Navigation — view state instead of router

Jarvis does not use Next.js client-side routing at this stage.
A single `view` state (`"chat" | "settings"`) in `page.tsx` drives the
center area.  The right sidebar (tabs) is always visible regardless of view.

```typescript
const [view, setView] = useState<"chat" | "settings">("chat");
```

`NavItem` receives an `onClick` prop (optional, backward-compatible).
`Dashboard` and `Chat` both set `view = "chat"`.
`Settings` sets `view = "settings"`.
`Memory` and `Files` remain `disabled` (planned).

Switching to Settings conditionally mounts `<SettingsPanel />`; switching back
conditionally mounts `<ChatPanel />`.  Chat history is in SQLite so remounting
ChatPanel is safe — history is reloaded on mount.

## Backend — GET /settings

A new read-only route (`apps/api/src/routes/settings.ts`) returns safe config:

| Field | Value | Secret? |
|---|---|---|
| `appVersion` | hardcoded `"0.8.0"` | no |
| `apiVersion` | hardcoded `"0.1.0"` | no |
| `environment` | `"local"` | no |
| `ollama.baseUrl` | from `config.ollama.baseUrl` (always localhost) | no |
| `ollama.defaultModel` | from `config.ollama.defaultModel` | no |
| `features.*` | boolean flags | no |
| `safety.workspaceLabel` | `"workspace/"` (label only, not full path) | no |

Fields intentionally **not** returned:
- Database path (`config.dbPath`)
- Full workspace absolute path (`config.allowedWorkspace`)
- TTS base URL (was already localhost-only but still excluded as it reveals port)
- Any `process.env` values that could contain secrets

## Frontend — SettingsPanel.tsx

`SettingsPanel` fetches three endpoints in parallel on mount:
- `GET /settings` — app config and feature flags
- `GET /health` — API liveness check
- `GET /ollama/status` — live Ollama state (reuses the same endpoint `StatusPanel` uses)

Five cards displayed:

| Card | Contents |
|---|---|
| Runtime | App version, API version + status, Frontend, Environment |
| Ollama | Provider label, base URL, configured model, active model, model count, connection status |
| Safety | File write, workspace writes, Project Library, email sending, terminal tools, cloud AI |
| Workspace | Workspace root label, feature flags for each workspace capability |
| Feature Status | Completed features (✓ done badges) and planned items |

### Badge system

Six variants with consistent colour semantics:

| Variant | Colour | Meaning |
|---|---|---|
| `enabled` / `done` | emerald | active and working |
| `disabled` | slate | intentionally off |
| `approval` | amber | user must confirm |
| `local` | cyan | local only, no cloud |
| `readonly` | indigo | view-only, no writes |
| `planned` | dark slate | not yet implemented |

### Read-only notice

A static amber note at the top of the panel reads:
> Settings are read-only in v0.8.0. Editing will be added in a later version.

## Why conditional mount (not CSS hidden)

- Consistent with the right sidebar tab approach used since v0.7.5.
- No `h-full` measurement issues from hidden containers.
- Chat state resets on view switch, but that is acceptable:
  - All history is persisted in SQLite.
  - No in-flight streaming is expected while navigating away
    (the user would have to click Settings while a response was streaming).

## Files changed

| File | Change |
|---|---|
| `apps/api/src/routes/settings.ts` | New — GET /settings endpoint |
| `apps/api/src/index.ts` | Register settingsRouter at /settings |
| `apps/web/src/components/SettingsPanel.tsx` | New — settings UI component |
| `apps/web/src/app/page.tsx` | Added `view` state; wired NavItem onClick; conditional center render; version string |
| `docs/decisions/054-settings-panel-foundation.md` | This document |
| `README.md` | Version bumped to v0.8.0, feature bullet added |

## What is NOT changed

| Component | Status |
|---|---|
| ChatPanel | Unchanged |
| StatusPanel | Unchanged |
| ActivityPanel | Unchanged |
| WorkspacePanel | Unchanged |
| ProjectLibraryPanel | Unchanged |
| All backend chat/files/projects/tts routes | Unchanged |
| Write-with-approval flow | Unchanged |
| TTS system | Unchanged |
| Right sidebar tabs | Unchanged |
| JarvisBrain repository | Untouched |

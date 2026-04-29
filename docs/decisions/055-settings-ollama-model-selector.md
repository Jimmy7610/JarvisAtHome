# Decision 055 - Settings Ollama Model Selector (v0.8.1)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.8.0 added a read-only Settings panel.  The Ollama card showed the configured
default model and the backend-resolved active model, but nothing was editable.
The user had no way to switch between installed Ollama models without restarting
the dev server and changing `.env`.

v0.8.1 makes the model choice a first-class local browser preference: a `<select>`
dropdown in the Settings panel lets the user pick any installed model on the fly.

## Design constraints

- **No backend config writes.** `.env` and `config.ts` are never touched.
- **No secrets.** The model name is a plain string forwarded to the Ollama API call.
  It cannot affect file paths, tool execution, or safety decisions.
- **No new backend routes.** The model override is a frontend-only preference.
  The existing `POST /chat/stream` already accepted an optional `model` field
  (see `validateAndResolve` in `apps/api/src/routes/chat.ts`).

## Data flow

```
localStorage["jarvis:selected-ollama-model"]
        ↓ on mount (page.tsx useEffect)
selectedModelOverride: string | null   (page.tsx state)
        ↓ prop
ChatPanel.modelOverride                — included in POST /chat/stream body
        ↓ prop
SettingsPanel.modelOverride            — shown in Ollama card + drives <select>
```

### Model resolution order (backend, unchanged)

1. Requested model from body — if installed.
2. Configured default (`OLLAMA_DEFAULT_MODEL`) — if installed.
3. First match from `PREFERRED_TEXT_MODELS` — if any installed.
4. First installed model.

So if the user selects a model that has since been uninstalled, the backend
falls back gracefully to the configured default.

## localStorage key

`jarvis:selected-ollama-model`

Value: plain model name string (e.g. `"qwen2.5-coder:latest"`).
Cleared by: "Reset to default" button in Settings → Ollama card.

## UI decisions

### Source badge

| State | Badge colour | Label |
|---|---|---|
| No override | slate | default config |
| Override active | amber | browser override |

Amber draws attention to the fact that the user has departed from the system
default — it is not a warning but a visibility cue.

### Dropdown visibility

- Shown only when Ollama is connected and at least one model is installed.
- Disabled state: when Ollama is offline, a short italic note replaces the
  dropdown: "Connect Ollama to enable model selector."

### Reset button

- Rendered next to the `<select>` only when an override is active (`modelOverride !== null`).
- Clears `localStorage`, sets state to `null`, logs an activity event.

### Activity log events

- Override set: `Ollama model override set to <model>` (type: info)
- Override cleared: `Ollama model override cleared — using default config` (type: info)

## State location

`selectedModelOverride` lives in `page.tsx` because it must be passed to both
`ChatPanel` (forwarded to the API) and `SettingsPanel` (drives the UI).  This
avoids prop drilling through an intermediate layer.

## Backend changes

None.  The `POST /chat/stream` endpoint already accepted `model?: string` and
forwarded it to `resolveModel()`.  The only frontend change to `ChatPanel` is
spreading `{ model: modelOverride }` into the fetch body when an override is set.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/app/page.tsx` | `OLLAMA_MODEL_KEY` const; `selectedModelOverride` state; load effect; `handleModelOverrideChange`; `handleModelOverrideClear`; prop pass-through to `ChatPanel` and `SettingsPanel`; version string |
| `apps/web/src/components/ChatPanel.tsx` | `modelOverride` prop added; included in `/chat/stream` fetch body |
| `apps/web/src/components/SettingsPanel.tsx` | Props interface; Ollama card redesigned with active model source badge, dropdown, reset button, and offline message; feature status row added; footer version bumped |
| `apps/api/src/routes/settings.ts` | `appVersion` bumped to `"0.8.1"` |
| `docs/decisions/055-settings-ollama-model-selector.md` | This document |
| `README.md` | Version bumped to v0.8.1; feature bullet added |

## What is NOT changed

| Component | Status |
|---|---|
| Backend chat/stream route logic | Unchanged (already had model field support) |
| Backend settings route | Only version string updated |
| StatusPanel | Unchanged |
| ActivityPanel | Unchanged |
| WorkspacePanel | Unchanged |
| ProjectLibraryPanel | Unchanged |
| Write-with-approval flow | Unchanged |
| TTS system | Unchanged |
| Right sidebar tabs | Unchanged |
| JarvisBrain repository | Untouched |

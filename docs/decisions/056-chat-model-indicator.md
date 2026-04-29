# Decision 056 - Chat Active Model Indicator (v0.8.2)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.8.1 added a localStorage-backed Ollama model selector in the Settings panel.
The user could pick a different model and it would be forwarded to `/chat/stream`,
but there was no indication in the Chat view of which model was actually active.
The user had to navigate back to Settings to verify their selection.

## Solution

Add a compact read-only pill to the ChatPanel header that always shows:
- the effective Ollama model name
- whether it comes from a browser override or the backend default config

## Data flow — no new backend route

```
page.tsx: fetch /settings (once, on mount)
  → setDefaultOllamaModel(d.ollama.defaultModel)
  → passed as defaultModel prop to ChatPanel

page.tsx: selectedModelOverride (already exists from v0.8.1)
  → passed as modelOverride prop to ChatPanel (already existed)

ChatPanel header pill:
  effective model = modelOverride ?? defaultModel ?? "default model"
  source label    = modelOverride ? "override" : (nothing)
```

`/settings` is fetched once by `page.tsx` on mount — the same endpoint that
`SettingsPanel` also fetches.  There is no duplication because:
- `page.tsx` only reads `d.ollama.defaultModel` (one field, fast path)
- `SettingsPanel` mounts and unmounts independently and reads the full response

## Pill design

```
[ Ollama · qwen2.5-coder:latest · override ]   ← amber "override" label when active
[ Ollama · qwen2.5-coder:latest ]              ← no label = backend default
[ Ollama · default model ]                     ← API not reachable on mount
```

Styling:
- `bg-slate-800/80 border border-slate-700/60 rounded-full` — dark pill
- Model name: `font-mono text-cyan-400 truncate max-w-[11rem]` — handles long names
- "override" label: `text-amber-400/80` — amber = non-default, consistent with SettingsPanel
- Hidden on `sm:` breakpoint and below to keep header clean on narrow viewports

The pill is `select-none` (no accidental text selection) and carries no interactive
behaviour — it is display-only.

## Why amber for "override"

Consistent with SettingsPanel v0.8.1 where the source badge is also amber when a
browser override is active.  Amber = "user-customised, not the system default" —
draws attention without implying an error.

## Props added to ChatPanel

| Prop | Type | Source | Purpose |
|---|---|---|---|
| `defaultModel` | `string \| null` | page.tsx → /settings | Display in header pill when no override |
| `modelOverride` | `string \| null` | already existed (v0.8.1) | Display + forwarded to /chat/stream |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/app/page.tsx` | `defaultOllamaModel` fetch effect; `defaultModel` prop on `<ChatPanel>`; version string |
| `apps/web/src/components/ChatPanel.tsx` | `defaultModel` prop added; model pill in header |
| `apps/api/src/routes/settings.ts` | `appVersion` bumped to `"0.8.2"` |
| `apps/web/src/components/SettingsPanel.tsx` | Footer fallback version bumped to `"0.8.2"` |
| `docs/decisions/056-chat-model-indicator.md` | This document |
| `README.md` | Version bumped to v0.8.2; feature bullet added |

## What is NOT changed

| Component | Status |
|---|---|
| Chat streaming logic | Unchanged |
| Model override forwarding to /chat/stream | Unchanged |
| Settings model selector | Unchanged |
| All workspace/project/TTS features | Unchanged |
| Backend routes (except version string) | Unchanged |
| JarvisBrain repository | Untouched |

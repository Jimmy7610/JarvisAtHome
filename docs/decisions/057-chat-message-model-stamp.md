# Decision 057 - Chat Message Model Stamp (v0.8.3)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.8.2 added a header pill showing the active Ollama model globally.
But once the user switches models, there is no way to tell which model
generated older responses in the same session.  A per-message model
stamp solves this: each assistant bubble shows exactly which model
produced it.

## Data source — backend already provides it

The streaming endpoint (`POST /chat/stream`) already sends a final
`{ type: "done", model: "<resolved-model>" }` chunk.  ChatPanel already
captured this in a local `modelName` variable and forwarded it to
`persistMessage` — but never stored it on the in-memory `ChatMessage` object.

**No backend changes were needed.**

## ChatMessage model field

```typescript
interface ChatMessage {
  role: "user" | "assistant" | "error" | "cancelled";
  text: string;
  model?: string;   // ← new (assistant messages only)
}
```

`model` is only meaningful on `role: "assistant"` messages.
User messages, error bubbles, cancelled markers, and the greeting have no stamp.

## When is `model` set?

| Situation | How model is set |
|---|---|
| Successful stream | `done` event → `modelName` → `setMessages` stamps last assistant msg |
| Cancelled with partial text | Same: `modelName` if captured, else `modelOverride ?? defaultModel` |
| Loaded from SQLite | `BackendMessage.model` mapped directly |
| Greeting / old history without model | `model` stays `undefined` — no stamp shown |

## Fallback chain for in-memory stamp

```
done event model       — most accurate: actual model resolved by backend
  ?? modelOverride     — user's explicit selection
  ?? defaultModel      — backend-configured default (fetched once on mount)
  ?? undefined         — no stamp (greeting, very old messages)
```

The `done` event model is always present for successful streams, so the
fallback is only relevant for cancelled-with-partial-text responses.

## UI

`AssistantMessage` gains an optional `model` prop.  The label line becomes:

```
Jarvis · qwen2.5-coder:latest        ← when model is known
Jarvis                                ← when model is unknown (greeting, etc.)
```

`model` is rendered in `text-slate-600` (dim, non-intrusive) next to the
cyan `Jarvis` label.  The stamp is compact, never wraps, and does not affect
the message bubble layout.

## History persistence

`BackendMessage.model` was already populated by `persistMessage` in earlier
versions.  The only change is that the field is now also carried into the
`ChatMessage` type when loading history, so persisted model names appear
after a page reload.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `ChatMessage.model` field; history load carries model; success + cancel paths stamp model; `AssistantMessage` prop + render |
| `apps/api/src/routes/settings.ts` | `appVersion` bumped to `"0.8.3"` |
| `apps/web/src/components/SettingsPanel.tsx` | Footer fallback version bumped |
| `apps/web/src/app/page.tsx` | Sidebar footer version string |
| `docs/decisions/057-chat-message-model-stamp.md` | This document |
| `README.md` | Version bumped to v0.8.3; feature bullet added |

## What is NOT changed

| Component | Status |
|---|---|
| Backend streaming route | Unchanged |
| `persistMessage` | Unchanged |
| Write proposal detection / approval | Unchanged |
| TTS controls | Unchanged |
| All workspace/project features | Unchanged |
| Header model pill (v0.8.2) | Unchanged |
| Settings model selector | Unchanged |
| JarvisBrain repository | Untouched |

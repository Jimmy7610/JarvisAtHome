# Decision 008 — Conversation Context

**Date:** 2026-04-27  
**Status:** Accepted

## Context

Each chat request previously sent only the system prompt and the current user
message to Ollama. Follow-up questions ("what did you just say?", "expand on
that", "and in Python?") always started from scratch. This was the most obvious
missing usability feature after streaming was working.

## Decision

The frontend now collects the recent user/assistant exchange from its in-memory
message list and sends it to the API as a `history` array. The API validates,
limits, and passes it to Ollama alongside the system prompt and the new message.

### What "history" is

Session/browser chat context only. It comes from the `ChatMessage[]` array
held in React state and persisted in `localStorage`. It is:

- **Not** long-term Jarvis memory.
- **Not** searchable.
- **Not** stored on the server.
- **Not** sent between devices.

Long-term memory, database storage, and RAG will be separate future milestones.

### Request shape (both endpoints)

```json
{
  "message": "current user message",
  "model": "optional-model-name",
  "history": [
    { "role": "user",      "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

`history` is optional. Both `POST /chat` and `POST /chat/stream` accept it.

### Backend validation rules

Implemented in `validateHistory()` in `apps/api/src/routes/chat.ts`:

| Rule | Value |
|---|---|
| `history` missing or not an array | Treated as empty — ignored |
| Allowed roles | `user`, `assistant` only |
| `system` role | Silently dropped |
| Non-object items | Silently dropped |
| Empty content | Silently dropped |
| Content max length | 4000 characters (truncated) |
| Max messages | 12 (last 12 kept) |

The frontend never sends system messages. The backend also never trusts it to.

### Ollama message order

```
[system prompt, ...validatedHistory, currentUserMessage]
```

Built by `buildMessages()` in `apps/api/src/services/ollama.ts`.
Used by both `callOllamaChat()` and `streamOllamaChat()`, which now accept a
pre-built `OllamaMessage[]` instead of `(userMessage, systemPrompt)`.

### Frontend exclusions from history

`buildHistory()` in `ChatPanel.tsx` filters out:
- The default UI greeting (not a real model response — never sent to Ollama).
- Error bubbles (not real conversation turns).
- Empty assistant placeholders (currently streaming, not yet complete).

### Context indicator

The chat header now shows `context: N msgs` — the number of turns being sent as
history. Resets to 0 after "Clear chat".

## What is NOT in this patch

- Long-term memory or RAG.
- Server-side conversation storage.
- Token counting or context window management (relies on Ollama's own handling).
- Ability to select how many turns to include.

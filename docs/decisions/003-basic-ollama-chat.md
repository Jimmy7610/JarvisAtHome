# Decision 003 — Basic Non-Streaming Ollama Chat

**Date:** 2026-04-27  
**Status:** Accepted

## Context

The skeleton and Ollama status detection are in place. The next step is the
first real chat round-trip: user types a message, Jarvis responds via Ollama.

## Decisions

### Non-streaming first

Ollama supports a streaming API, but non-streaming (`stream: false`) is
simpler to implement correctly and easier to test. Streaming will be added in
a later milestone once the basic round-trip is stable.

### Single system prompt, no history

For v0.1 chat each request sends only the system prompt + the current user
message. No conversation history is included. This keeps the implementation
minimal and avoids the need for any session or memory management at this stage.

### In-memory message list in the frontend

The `ChatPanel` maintains a `ChatMessage[]` array in React state. It is
not persisted. Messages disappear on page refresh. Persistence (local storage
or database) is a later milestone.

### `POST /chat` always returns HTTP 200

Same convention as `/ollama/status`: the HTTP status reflects whether the
Jarvis API itself responded, not whether Ollama succeeded. The `ok` boolean
inside the body carries the semantic result. This keeps frontend error
handling uniform across all Jarvis API routes.

### 60-second timeout on Ollama requests

Large models can take 20–40 seconds to generate a response on the first
token. A 60-second `AbortSignal.timeout` gives enough headroom without
hanging indefinitely.

### Enter to send, Shift+Enter for newlines

Standard chat UX. Avoids needing a separate button for multi-line input.

## What is NOT in this patch

- Streaming responses
- Conversation history / memory
- Model selection UI
- Persistent chat storage

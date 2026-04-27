# Decision 006 — Streaming Ollama Chat

**Date:** 2026-04-27  
**Status:** Accepted

## Context

The non-streaming `/chat` route works correctly, but the UI shows a loading
spinner and only reveals the full response once Ollama finishes. For longer
answers this can mean 10–30 seconds of a blank bubble. Streaming lets the
user read the response as it is generated, which feels dramatically faster.

## Decision

### New route: POST /chat/stream

A new route was added at `POST /chat/stream` alongside the existing
`POST /chat`. The original route is unchanged and remains available for
testing or as a fallback.

The streaming route uses the same model resolution logic and system prompt as
the non-streaming route. The system prompt was moved to `services/ollama.ts`
as `JARVIS_SYSTEM_PROMPT` so both routes share it without duplication.

### Protocol: newline-delimited JSON (NDJSON)

Each chunk written to the HTTP response is one JSON object followed by `\n`:

```
{"type":"token","content":"Hello"}
{"type":"token","content":" world"}
{"type":"done","model":"llama3:latest"}
```

Errors are also sent as a chunk: `{"type":"error","error":"..."}`.

This was chosen over Server-Sent Events (SSE) because SSE requires GET or
a workaround for POST, and NDJSON over a plain fetch stream is simpler and
sufficient here.

### Frontend streaming loop

The `ChatPanel` component:
1. Sends `POST /chat/stream` with the user message.
2. Immediately shows the user bubble.
3. Adds an empty assistant bubble.
4. Shows thinking dots until the first token arrives.
5. Replaces dots with the growing assistant bubble as tokens arrive.
6. Shows a blinking cursor at the end of the text while streaming.
7. Persists to localStorage once streaming ends (not on every token).

### localStorage persistence during streaming

The `useEffect` that saves to localStorage now only runs when `loading`
becomes false. This avoids a localStorage write on every token update (which
could be hundreds per response).

### This is still single-turn

No conversation history is sent to Ollama. Each message is still a fresh
`[system, user]` two-message array. Multi-turn context / memory comes later.

## What is NOT in this patch

- Conversation history sent to Ollama
- Abort / cancel button to stop a stream mid-generation
- Token-per-second or latency display
- Model selection in the UI

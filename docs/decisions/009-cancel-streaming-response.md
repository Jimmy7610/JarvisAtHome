# Decision 009 — Cancel Streaming Response

**Date:** 2026-04-27  
**Status:** Accepted

## Context

Once a streaming request was sent, the user had no way to stop it short of
refreshing the page. Long responses from slow models could leave the UI
blocked for tens of seconds with no escape.

## Decision

### AbortController (frontend only)

Cancellation is implemented entirely on the frontend using the standard
`AbortController` / `AbortSignal` Web API. The API and Ollama service are
unchanged.

```
user clicks Stop
  → cancel() → abortControllerRef.current.abort()
  → fetch() or reader.read() throws DOMException { name: "AbortError" }
  → catch block detects AbortError → handled as cancellation, not error
```

### Lifecycle

| Moment | Action |
|---|---|
| `send()` called | `new AbortController()` created; stored in `abortControllerRef` |
| `fetch()` call | `signal: controller.signal` passed |
| Stream reading | Signal propagates through the ReadableStream reader |
| `finally` block | `abortControllerRef.current = null` |
| Stop clicked | `abortControllerRef.current?.abort()` |

### Partial text is preserved

When the user cancels mid-stream, any tokens that already arrived remain in
the assistant bubble. The response is not wiped.

### "Response cancelled." vs error bubble

Cancellation is a user action, not a failure. A `"cancelled"` role was added
to the `ChatMessage` union (alongside `"user"`, `"assistant"`, `"error"`).

- Displayed by `CancelledMessage` — muted, italic, no red styling.
- If text was already streaming when cancelled, the partial text stays as an
  assistant bubble (no cancelled indicator added).
- If no tokens had arrived, the empty placeholder is replaced with the
  `"cancelled"` bubble showing "Response cancelled."

### Conversation history exclusion

`buildHistory()` explicitly filters out `"cancelled"` role messages so they
are never sent to Ollama as context turns.

### Stop button layout

The Stop button is always rendered (to prevent layout shift) but set to
`invisible pointer-events-none` when not loading. During loading it becomes
visible with a neutral slate style — not dominant, not alarming.

## API changes

None. The backend continues to stream until the client disconnects. On abort,
the browser drops the connection; the server will detect this the next time it
tries to write a chunk and end the response naturally.

## What is NOT in this patch

- Server-side abort propagation to Ollama (Ollama keeps generating; the
  client just stops reading).
- Token count or generation speed display.
- Keyboard shortcut for cancel (Escape).

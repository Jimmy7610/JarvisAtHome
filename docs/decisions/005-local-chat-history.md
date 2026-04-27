# Decision 005 — Local Browser Chat History

**Date:** 2026-04-27  
**Status:** Accepted

## Context

After basic chat was working, messages disappeared on every page refresh.
A lightweight persistence layer is needed so conversations survive a reload
without introducing a backend database or network dependency at this stage.

## Decision

Chat messages are stored in the browser's `localStorage` under the key
`jarvis.chat.v1`.

### Why localStorage

- Zero backend changes required.
- Works entirely offline.
- Simple JSON round-trip — no schema migrations needed at this stage.
- Easy to wipe: one `localStorage.removeItem` call.

### What this is NOT

This is **not** Jarvis memory. It is not searchable, not sent to Ollama as
context, and not synced anywhere. It is a convenience so the chat log is not
lost on refresh. Backend/database memory with retrieval-augmented generation
(RAG) will be a separate milestone.

### SSR safety

`localStorage` is accessed only inside:
- A lazy `useState` initialiser (`typeof window === "undefined"` guard).
- A `useEffect` (client-side only by definition).
- The `clearChat` handler (only callable after hydration).

The component carries `"use client"` so Next.js never attempts to render it
on the server, but the guards are kept anyway as a belt-and-suspenders measure.

### Key versioning

The key is `jarvis.chat.v1`. If the message schema changes in a future
milestone, bumping the key suffix (e.g. `v2`) avoids silently loading
incompatible data from an older session.

### Error handling

- Invalid JSON in storage → silently reset to default greeting.
- Storage quota exceeded on write → silently skip saving (not fatal).

## What is NOT in this patch

- Backend chat persistence (database, file, API).
- Jarvis memory / RAG.
- Per-conversation sessions or titles.
- Export or import of chat history.

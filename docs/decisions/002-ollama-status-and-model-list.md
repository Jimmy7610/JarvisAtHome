# Decision 002 — Ollama Status Detection and Model Listing

**Date:** 2026-04-27  
**Status:** Accepted

## Context

Before connecting chat to Ollama, Jarvis needs to know whether Ollama is
running and which models are available. This gives useful feedback in the
dashboard and prevents silent failures when chat is wired up.

## Decisions

### API proxies Ollama — frontend never calls Ollama directly

The frontend calls `GET /ollama/status` on the Jarvis API, which in turn
calls `GET /api/tags` on Ollama. Reasons:

- Keeps the Ollama base URL server-side (not hard-coded in client bundle).
- A single place to change the URL or add auth later.
- Allows the API to return a safe, shaped response even when Ollama is down.

### Always return HTTP 200 from `/ollama/status`

The route always returns 200 with an `ok` boolean. A non-200 from the Jarvis
API itself would mean the API crashed, which is a different problem. This
makes frontend error handling simple: check `data.ok`, not the HTTP status.

### Native `fetch` — no extra HTTP client dependency

Node 20 ships with global `fetch`. Using it keeps the dependency list minimal.
`AbortSignal.timeout(5000)` provides a 5-second hard timeout so the route
never hangs if Ollama is stalled.

### Centralised config module

`apps/api/src/config.ts` exports a single `config` object read from env at
startup. All routes import from there instead of reading `process.env`
directly, making env usage easy to audit.

## What is NOT in this patch

- Chat completion (next milestone)
- Model selection UI
- Streaming

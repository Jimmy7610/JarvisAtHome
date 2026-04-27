# Decision 004 — Ollama Model Fallback

**Date:** 2026-04-27  
**Status:** Accepted

## Context

The configured default model (`qwen2.5-coder:latest`) was not installed on
the development machine. Installed models were `llava:latest` and
`llama3:latest`. Without a fallback, every chat request would fail with a
model-not-found error from Ollama.

The principle: Jarvis should work with whatever models the user already has
installed. It should never require a download before the first chat works.

## Decision

Jarvis resolves the model to use at request time using a priority chain:

1. **Requested model** — if the caller explicitly asks for a model and it is installed, use it.
2. **Configured default** (`OLLAMA_DEFAULT_MODEL`) — if it is installed, use it.
3. **Preferred text models** — a ranked list of well-known text-focused models; use the first one that is installed.
4. **Any installed model** — use whatever is available.
5. **No models installed** — return a clear error telling the user to run `ollama pull`.

Vision models (e.g. `llava`) are intentionally placed below pure text models in the
preference list. They can respond to text, but their defaults and token limits are
optimised for image input.

## Shared service module

Logic lives in `apps/api/src/services/ollama.ts` and is shared by both
`/ollama/status` and `/chat`. This avoids duplicating the fetch-and-parse
pattern for `/api/tags` and keeps model resolution in one place.

## Status endpoint change

`/ollama/status` now returns `configuredDefaultModel` and
`resolvedDefaultModel` as separate fields. The frontend uses these to show a
friendly notice when the configured model is missing but chat still works via
a fallback.

## dotenv

`dotenv` is loaded at the top of `index.ts` (before any other imports) so
that `.env` values are available when `config.ts` is evaluated. The fallback
defaults in `config.ts` still apply when no `.env` file is present.

## What is NOT in this patch

- Streaming
- Conversation history
- Model selection UI (user picking a model in the chat)

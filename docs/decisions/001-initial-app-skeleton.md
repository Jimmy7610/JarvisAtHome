# Decision 001 — Initial App Skeleton

**Date:** 2026-04-27  
**Status:** Accepted

## Context

Jarvis v0.1 needs a minimal working frontend and backend scaffold before Ollama
integration, file tools, email, or any other features are added.

## Decisions

### Framework choices

| Layer    | Choice              | Reason |
|----------|---------------------|--------|
| Frontend | Next.js 14 App Router | Standard React meta-framework; App Router is the current direction |
| Styling  | Tailwind CSS        | Utility-first, no heavy runtime, easy dark-mode theming |
| Backend  | Express + TypeScript | Minimal, well-understood, easy to extend |
| Dev runner | `ts-node-dev`     | Fast TypeScript reload without a separate compile step |

### Concurrent dev script

`concurrently` (a single small dev dependency at the root) is used to run both
`apps/api` and `apps/web` with one `npm run dev` command. It was chosen over
`npm-run-all` because it provides labelled, colour-coded output and is a common
choice in monorepos.

### Port layout

| Service  | Port |
|----------|------|
| Next.js  | 3000 |
| API      | 4000 |
| Ollama   | 11434 (future) |

### What is NOT in this skeleton

- No Ollama connection (v0.1 follow-up)
- No chat history persistence
- No file tools
- No email
- No Home Assistant
- No voice

## Consequences

The API exposes `/health` and `/` only. The frontend reads `/health` on page
load to show live API status. Everything else is a visual mock that will be
wired up in subsequent milestones.

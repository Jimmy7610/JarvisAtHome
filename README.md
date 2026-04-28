# Jarvis

Jarvis is a local-first personal AI assistant built for Jimmy Eliasson.

It runs entirely on your own machine and uses [Ollama](https://ollama.com) as the only AI provider. No data is sent to cloud AI services.

## What Jarvis can do right now (v0.4.0)

- **Chat with local Ollama models** — streaming, token-by-token responses.
- **Stop streaming** mid-response with a cancel button.
- **Conversation context** — the last 12 messages are sent with each request so Jarvis can follow up.
- **Multiple chat sessions** — create, switch, rename and delete sessions from the sidebar.
- **Persistent chat history** — all messages are stored in a local SQLite database that survives browser refreshes and clears.
- **Auto-title** — the session title is set from your first message automatically.
- **Keyboard shortcut** — `Ctrl+Alt+N` creates a new chat from anywhere on the page.
- **Ollama status panel** — shows whether Ollama is reachable and which models are available.
- **System activity log** — live activity feed in the right panel.
- **Read-only workspace file browser (v0.2.1)** — list and read text files from the `workspace/` sandbox directory. Path traversal protected. No writes.
- **Attach file to chat (v0.2.2)** — click "Attach to chat" on a previewed file to include its content in your next message. File content is prepended to the API request in a labelled fenced block. Attachment clears after send. No autonomous LLM file access.
- **Workspace folder navigation (v0.2.3)** — click into subdirectories (`drafts/`, `projects/`, `sandbox/`, and nested folders) directly in the Workspace Files panel. Breadcrumb path indicator shows the current location. Up arrow and clickable breadcrumbs navigate back. Everything remains inside the sandbox workspace.
- **Ask Jarvis about this file (v0.2.4)** — one click attaches a workspace file and pre-fills a suggested question in the chat input. Nothing is sent automatically — edit the question and press Send.
- **Workspace refresh (v0.2.5)** — a ↻ button in the Workspace Files panel header reloads the current folder listing. If the previewed file is no longer present after refresh, the preview is cleared automatically.
- **Write-with-approval (v0.3.0)** — file writes are now possible but only through an explicit two-step flow: "Propose safe edit" creates a pending proposal with a diff preview; "Approve write" applies it. Nothing is ever written automatically. All writes are sandboxed to the workspace directory.
- **Write activity events (v0.3.1)** — propose, approve, cancel, and failure events from the write-with-approval flow now appear in the Activity Log panel with amber (write) or red (error) styling.
- **Chat-created write proposals (v0.3.2)** — when the assistant response contains a `jarvis-write-proposal` fenced block, ChatPanel automatically creates a pending write proposal and shows a diff with Approve/Cancel buttons. Nothing is written until the user clicks "Approve write". All workspace safety rules still apply.
- **Improved write proposal display and UI polish (v0.3.3)** — the raw fenced block in assistant messages is now replaced with a styled amber callout card showing the target path and a note to review the diff below. Chat input auto-grows with content (min 72px, max 200px). Activity Log cards have better padding and text wrapping.
- **Write approval diff readability and cancel event (v0.3.4)** — the diff panel now has a fixed header showing the target path, a scrollable diff body with 2 px left border accents (green for added, red for removed, transparent for context), and context lines are brighter (`slate-400`). Cancelling a write proposal now emits an amber Activity Log event (was plain info).
- **Local email drafts (v0.4.0)** — ask Jarvis to write an email and it proposes a Markdown draft file under `workspace/drafts/`. The existing write-with-approval flow is reused: diff shown, Approve write required, nothing sent. No connection to any email service.
- **New file creation with approval (v0.4.0)** — the write-with-approval flow now supports creating new files (not just editing existing ones). New files are shown with a "new file" badge and an all-green diff. The parent directory must already exist inside `workspace/`; no directories are created automatically. Applies to email drafts in `workspace/drafts/` and any other new workspace file proposals.
- **Robust write proposal parsing (v0.4.0)** — the frontend proposal parser now recovers from malformed JSON where local Ollama models emit literal newlines inside JSON strings instead of `\n` escapes. The repair runs only when the `jarvis-write-proposal` marker is present and standard parsing fails. Backend validation and the Approve step are unchanged.

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| [Ollama](https://ollama.com) | running locally |

Ollama must be running at `http://localhost:11434` with at least one model pulled:

```bash
ollama pull qwen2.5-coder:latest
```

Any Ollama model works. The default is `qwen2.5-coder:latest`, configurable via `OLLAMA_DEFAULT_MODEL`.

## Install

```bash
git clone https://github.com/Jimmy7610/Jarvis.git
cd Jarvis
npm install
```

## Configure

Copy the example environment files and adjust if needed:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

The defaults work out of the box for local development.

## Run

```bash
npm run dev
```

This starts both the frontend and the API together:

| Service | URL |
|---|---|
| Frontend (Next.js) | http://localhost:3000 |
| Backend API (Express) | http://localhost:4000 |
| Ollama (external) | http://localhost:11434 |

Run them separately if needed:

```bash
npm run dev:web   # frontend only
npm run dev:api   # API only
```

## Build

```bash
npm run build
```

Compiles the TypeScript API and produces an optimised Next.js production build.

## Lint

```bash
npm run lint
```

Runs `tsc --noEmit` on the API and `next lint` on the frontend. Both must pass clean.

## Verify SQLite

```bash
npm run verify:sqlite --workspace=apps/api
```

Confirms that `better-sqlite3` loads correctly on your platform (win32 / Node v24+).

## Project structure

```
apps/web        — Next.js 14 frontend (dashboard, chat UI, session sidebar)
apps/api        — Express + TypeScript backend (Ollama proxy, SQLite persistence)
packages/       — Shared packages (core, tools, memory, config) — not yet implemented
data/memory/    — Local SQLite database (gitignored)
docs/           — Architecture notes, decision logs, prompts
workspace/      — Safe area for future file tools
```

## Data storage

Chat sessions and messages are stored in:

```
data/memory/jarvis.sqlite
```

This file is local-only and gitignored. It is created automatically on first API start.

## Safety rules

- **Ollama only.** No OpenAI, Claude API, Gemini, Groq or other cloud AI provider is used inside the app.
- **No file tools yet.** Jarvis cannot read or write project files in v0.1.
- **No email sending.** Email drafts are saved as local Markdown files in `workspace/drafts/` with explicit write approval required. No connection to any email provider.
- **No Home Assistant.** Smart home integration is planned for v0.6.
- **No voice.** Voice input/output is planned for v0.5.
- **No secrets in commits.** Use `.env` files (gitignored). See `.env.example` files.

## Current limitations

- No RAG or semantic memory — Jarvis cannot search past conversations.
- File tools are read-only — no writes, edits, or deletes yet (v0.2.3+).
- File browser shows workspace root only — no subdirectory navigation yet (v0.2.3+).
- Only one file can be attached per message — attaching a second replaces the first.
- No voice input or output.
- No smart home integration.
- No cross-device sync — the SQLite database is local to one machine.
- Chat history cannot be exported.
- No multi-user support.
- No dark/light theme toggle (dark mode only).

## Planned milestones

| Milestone | Goal |
|---|---|
| v0.2 | File tools — read files, propose edits, show diffs, require approval |
| v0.3 | Memory — local memory, project notes, user preferences |
| v0.4 ✓ | Email drafts — local Markdown files in `workspace/drafts/`, write-with-approval, no sending |
| v0.5 | Voice — microphone input, text-to-speech output |
| v0.6 | Smart Home — Home Assistant integration |

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+N` | New Chat |
| `Enter` (in rename input) | Save renamed title |
| `Escape` (in rename input) | Cancel rename |

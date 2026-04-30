# Jarvis

Jarvis is a local-first personal AI assistant built for Jimmy Eliasson.

It runs entirely on your own machine and uses [Ollama](https://ollama.com) as the only AI provider. No data is sent to cloud AI services.

## What Jarvis can do right now (v1.1.4)

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
- **Open draft from success state (v0.4.1)** — after approving a `drafts/` write proposal in chat, the success banner shows the created file path and an "Open draft in Workspace Files" button. Clicking it navigates the Workspace Files panel to `drafts/` and previews the newly created file. Non-draft writes keep the existing success message unchanged.
- **Copy draft content (v0.4.2)** — the draft success banner also shows a "Copy draft content" button that writes the approved Markdown text directly to the clipboard. The button shows "✓ Copied" for 2 seconds on success, or an inline error if the clipboard API is unavailable. No email is sent; nothing is written.
- **Voice input (v0.5.0)** — a mic button in the chat input bar uses the browser Web Speech API to transcribe one utterance at a time and append it to the input field. Nothing is sent automatically. Shows a pulsing "Listening…" indicator while active; reports microphone permission errors inline. Off when the browser does not support the API.
- **Voice replies / TTS (v0.5.0)** — a "Voice replies: off/on" toggle below the input bar uses the browser SpeechSynthesis API to read each new assistant response aloud after streaming completes. Off by default. When a write proposal is present the spoken text is replaced with a neutral summary to avoid reading raw JSON. Toggling off immediately cancels any speech in progress. No cloud services used.
- **Speech language selector (v0.5.1)** — a compact voice bar below the input shows a language dropdown with Swedish (sv-SE) and English (en-US). The selected language is used for both mic recognition and TTS utterances. Selection persists across page reloads via localStorage. Default is Swedish (sv-SE). Voice controls (language, TTS toggle, speaking status) are grouped in this bar and only shown when the browser supports at least one voice API.
- **Browser voice selector (v0.5.2)** — a second dropdown in the voice bar lists all voices installed on the OS and/or bundled with the browser (via `speechSynthesis.getVoices()`). The selected voice is applied to every TTS utterance. A "Test voice" button speaks a short preview phrase (language-aware) so the user can audition voices before committing. The selection persists via localStorage. No external TTS services used.
- **TTS provider abstraction (v0.5.3)** — a "TTS:" dropdown in the voice bar lets you select between "Browser voice" (Web SpeechSynthesis, default) and "Local TTS (planned)" (future Piper/Kokoro integration). The speak logic is split into `speakWithBrowserTts` and `speakWithLocalTts` so the routing is clean. Local TTS is not yet active — selecting it shows a "not yet active" note and a friendly error on voice replies. Selection persists via localStorage.
- **Local TTS HTTP provider foundation (v0.5.4)** — the Jarvis API now exposes `POST /tts/speak` which proxies to a local TTS server (Piper, Kokoro, or any compatible server). Disabled by default (`LOCAL_TTS_ENABLED=false`). Only `localhost` upstream URLs are accepted — remote URLs are rejected at startup. The frontend calls the Jarvis API (never the TTS server directly) and plays returned audio bytes through `HTMLAudioElement`. Stop voice and Voice replies toggle cancel local audio. No Piper/Kokoro binaries are installed by this change. Set `LOCAL_TTS_ENABLED=true` and `LOCAL_TTS_BASE_URL=http://localhost:5005` in `apps/api/.env` when a local TTS server is running.
- **Local TTS setup guide and mock server (v0.5.5)** — `docs/setup/local-tts-server.md` documents the full architecture, safety rules, Piper/Kokoro overview, environment configuration, and step-by-step test instructions. A zero-dependency development mock server (`scripts/local-tts-mock-server.mjs`) returns a 440 Hz WAV beep so the complete audio transport path can be tested without installing any real TTS engine. Run it with `npm run dev:tts-mock`. Piper and Kokoro are still not bundled.
- **Piper TTS HTTP wrapper foundation (v0.5.6)** — `scripts/local-tts-piper-server.mjs` is a zero-dependency Node.js HTTP wrapper around the Piper binary. Download the Piper binary and an ONNX voice model separately, set `PIPER_BIN` and `PIPER_VOICE_MODEL` environment variables, and run `npm run dev:tts-piper`. The server listens on `http://127.0.0.1:5005`, accepts `POST /speak`, spawns Piper with `--output_file` (reliable WAV output across all platforms), and returns `audio/wav`. No Piper binary is bundled — see `docs/setup/local-tts-server.md` section H for the full Windows setup guide.
- **Windows Piper setup helper (v0.5.7)** — `scripts/setup-piper-windows.ps1` is an optional PowerShell script that automates the Piper download and directory setup. Fill in the three URL variables at the top of the script (Piper release zip URL and voice model URLs from the official sources), then run `powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1`. The script creates gitignored `local-tts/piper/` and `local-tts/voices/` directories, downloads only missing files, and prints the exact env var commands and `.env` settings you need. If URLs are still placeholders the script exits safely with instructions. No binaries or models are bundled in the repo.
- **Piper Windows setup checklist (v0.5.8)** — `docs/setup/piper-windows-checklist.md` is a step-by-step guide for the complete Piper installation process. It covers where to find official Piper release and voice model URLs (GitHub releases, HuggingFace rhasspy/piper-voices), how to choose a voice (clear/calm English, no fictional character imitation), how to fill in the setup script URL variables, and how to test with PowerShell and curl commands. Official URL selection remains manual — version tags change with each Piper release. The setup script placeholder error output now references this checklist directly.
- **Piper official download URLs selected (v0.5.9)** — `scripts/setup-piper-windows.ps1` now has real verified URLs pre-filled: Piper release `2023.11.14-2` (Windows x64 zip, ~21 MB) and voice `en_GB-alan-medium` (British English male, medium quality, ~60 MB). All URLs were verified with HTTP HEAD requests. A `-DryRun` flag was added — run `powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1 -DryRun` to preview what will be downloaded without downloading anything. Real local Piper setup is ready for manual run. No binaries or models are bundled in the repo.
- **Quick launcher for Jarvis + Piper dev (v0.5.10)** — `scripts/start-jarvis-with-piper.ps1` opens both the Piper TTS wrapper and the Jarvis dev stack in separate PowerShell windows with a single command: `powershell -ExecutionPolicy Bypass -File .\scripts\start-jarvis-with-piper.ps1`. Checks that Piper is installed before starting; exits with setup instructions if files are missing. Detects port 5005 conflicts and skips the Piper window gracefully. Warns if `apps/api/.env` is missing or `LOCAL_TTS_ENABLED=true` is not set. Optional `-SkipPiper` and `-SkipJarvis` flags for partial starts. Does not download, install, or modify anything.
- **Project Library (v0.7.0)** — a read-only panel in the right sidebar that browses `workspace/projects/`. Click a project to list its text files recursively; click a file to read it. Supports `.md`, `.ts`, `.tsx`, `.js`, `.json`, `.yaml`, `.css`, `.html`, `.sh`, `.ps1`, and more. Binary files, build artifacts, and `node_modules` are excluded. Files are capped at 200 KB. No writes — the panel is a viewer only. Backend routes: `GET /projects`, `GET /projects/:name`, `GET /projects/:name/file`. All paths are sandboxed with traversal protection.
- **Attach Project Library file to chat (v0.7.1)** — click "Attach" on any previewed project file to queue its content for the next message. An indigo attachment chip appears above the chat input showing the project and file path with a remove button. When sent, the file content is prepended to the API request in a clearly labelled fenced block; the user bubble shows only the typed message and a small label. The attachment clears automatically after send. Temporary one-message context only — no RAG, no vector DB, no long-term memory.
- **Ask Jarvis about this project file (v0.7.2)** — click "Ask Jarvis" on any previewed project file to attach it AND prefill the chat input with `Explain this project file and suggest safe improvements.` Edit the question as desired and press Send. Reuses the same `prefillInput` mechanism as the WorkspacePanel "Ask Jarvis about this file" feature — no new ChatPanel props needed. Project Library remains read-only.
- **Project Library search (v0.7.3)** — a search input above the project file list filters files by name or relative path as you type. Case-insensitive substring match. Shows a match count while a query is active and a "No matching files." empty state with a clear button when nothing matches. Directory header rows are hidden during search (flat results only). Clicking a search result opens the file normally — Attach and Ask Jarvis still work. Frontend-only filter over the already-loaded file list; no backend round-trip per keystroke. Search clears automatically when switching projects.
- **Workspace Files search (v0.7.4)** — a search input above the Workspace Files listing filters the current directory entries by name or path as you type. Case-insensitive substring match on both files and folders. A running match count appears beside the input; "No matching workspace files." with a Clear link is shown when nothing matches. Folder results are still navigable. Clicking a file result opens the preview normally — Attach, Ask Jarvis, and Propose safe edit all work unchanged. Current-directory filter only (matches the existing one-directory-at-a-time navigation model). Search clears automatically on every directory navigation.
- **Right sidebar tabs (v0.7.5)** — the four right-sidebar panels (System Status, Activity Log, Workspace Files, Project Library) are now presented as a compact tab bar instead of a crowded vertical stack. Only one panel is visible at a time, giving each the full sidebar height (~830 px at 900 px screen height vs. the previous 120–280 px). Active tab is highlighted with a cyan underline. Default tab is Workspace. No panel components were changed — only the layout in `page.tsx`.
- **Settings Panel foundation (v0.8.0, read-only)** — clicking Settings in the left sidebar now opens a dedicated Settings view instead of the chat area. The panel shows five read-only cards: Runtime (app/API version, environment), Ollama (provider, base URL, active model, connection status), Safety (file write approval, disabled email/terminal/cloud), Workspace (feature flags per capability), and Feature Status (completed and planned milestones). Data is fetched from a new `GET /settings` backend endpoint that returns only non-secret config. No editing, no `.env` writes, no secrets exposed. Clicking Dashboard or Chat returns to the normal chat view.
- **Ollama model selector (v0.8.1)** — the Settings → Ollama card now includes a live dropdown of all installed Ollama models. Selecting a model saves it to browser `localStorage` under the key `jarvis:selected-ollama-model` and all subsequent chat messages use that model. The active model row shows which model is in use and a source badge indicates whether it comes from the default backend config or a browser override. A "Reset to default" button appears when an override is active and clears it from `localStorage`. Does not modify `.env` or any backend configuration. If Ollama is offline the dropdown is replaced with an informational note.
- **Chat active model indicator (v0.8.2)** — the ChatPanel header now shows a compact pill displaying the effective Ollama model name and its source: `Ollama · qwen2.5-coder:latest · override` when a browser model override is active, or `Ollama · qwen2.5-coder:latest` when using the backend default. If the API has not yet responded the pill shows `Ollama · default model`. The pill updates immediately when the user changes or resets the model in Settings. No new backend routes — the model name is fetched once from the existing `/settings` endpoint on page load.
- **Per-message model stamp (v0.8.3)** — each assistant message now shows which Ollama model generated it: `Jarvis · qwen2.5-coder:latest`. The actual resolved model is captured from the `{ type: "done", model }` stream event (no backend changes needed — this data was already sent). Persisted messages reload their model stamp after page refresh. Messages without a stored model (the greeting, very old history) show just `Jarvis` without a stamp. When model is switched mid-session, earlier and later messages each retain their own correct stamp.
- **Memory foundation (v0.9.0, manual-only)** — a local Memory area is now accessible from the left sidebar. The user can manually add, view, search, and delete memory notes in three categories: Note, Preference, and Project. Memories are stored in the existing local SQLite database (no new dependency). **Memory is manual-only in v0.9.0 — no automatic injection into the Ollama system prompt, no autonomous memory writes, no cloud services.** The Settings panel shows a Memory card confirming all safety flags. Activity Log events are emitted for add/delete (title only, never full content).
- **Memory opt-in chat context (v0.9.1)** — each memory note now has an **Include** toggle button. Selected notes are prepended to the next outgoing chat message as explicit context so the local Ollama model can use them. A purple summary banner in the Memory panel shows how many notes are active, and a matching chip appears above the ChatPanel input with a clear button. The user bubble shows `[Memory context: N notes]` for transparency. Selection persists across view switches until manually cleared — it is never cleared automatically. **Memory is injected only when the user explicitly selects notes — no automatic injection, no AI-controlled selection, content never logged.** Sent only to the local Ollama endpoint; never to cloud services.
- **Persistent selected memory context (v0.9.2)** — the Include selection from v0.9.1 now survives browser refresh. Selected memory note IDs are saved to `localStorage`. On page load, Jarvis reads the saved IDs, fetches `GET /memory`, and restores the full selected context for notes that still exist. Stale IDs from deleted notes are cleaned up automatically. Full memory content is never stored in `localStorage`; it stays in local SQLite only. Memory context remains entirely opt-in and user-controlled.
- **Memory nav badge (v0.9.3)** — the Memory item in the left sidebar now shows a compact right-aligned counter: the total number of memory notes and, when any are selected for chat context, the active count (e.g. `4 · 2✓`). The total is loaded on page startup via a single `GET /memory` call (the same call that restores persisted selected IDs) and kept live by a callback from MemoryPanel after add/delete operations. No new API endpoints; no backend changes.
- **Memory stats in Settings (v0.9.4)** — the Settings → Memory card now shows live stats alongside the existing capability flags: total memory note count and how many are currently selected for chat context. The values come directly from `page.tsx` state (no extra API call) so they are always in sync with the nav badge and the memory context chip. The selected count is highlighted purple with an "active" badge when non-zero. Feature Status was updated to reflect all completed memory milestones (v0.9.2–v0.9.4).
- **First stable release (v1.0.0)** — documentation and status polish pass. Added an About Jarvis card to the Settings panel showing identity, safety model, and feature highlights at a glance. Feature Status updated with chat active model indicator, per-message model stamp, and a planned section covering full voice assistant, real email integration, multi-file proposals, and agent workflows. All version strings, sidebar footer, and README updated to v1.0.0. No new runtime behaviour; no feature removals.
- **Memory cleanup / duplicate detection (v1.1.4)** — a **Find duplicates** button in the Memory panel analyses the current note list locally in the browser and shows likely duplicate groups. Two detection levels: **Exact duplicate** (same type, title, and content) and **Same title** (same type and title, but different content). Clicking a row in the results jumps to that note in the list so the user can Edit or Delete it. **Nothing is changed automatically** — this is a read-only advisory tool. No backend call; no AI involved. The results stay visible until dismissed or re-run.
- **Memory export/import (v1.1.3)** — the Memory panel has **Export** and **Import** buttons. Export downloads all notes as a portable `jarvis-memory-export-YYYY-MM-DD.json` file (type, title, content, pinned state — no database IDs). Import reads any such file, shows a preview (count, type breakdown), and requires explicit confirmation before writing. Duplicate notes (same type + title + content) are skipped automatically. Fresh database IDs are generated on import — the file IDs are never used. **Imported memories are not automatically included in any chat** — use the "In this chat" toggle per note as with any other memory.
- **Pin/favorite memories (v1.1.2)** — each memory note now has a **☆ Pin** button. Clicking it marks the note as pinned (★ Pinned with an amber card highlight) and moves it to the top of the memory list. Pinned status is stored in SQLite and persists across page reloads. **Pinned does not automatically include the note in chat** — the "In this chat" toggle remains a separate explicit opt-in. Existing filters, search, edit, and delete all work on pinned notes. A safe `ALTER TABLE` migration adds the `pinned` column to existing databases without data loss.
- **Memory type filter and improved search (v1.1.1)** — the Memory panel now has a compact filter bar with five pills: **All**, **Preferences**, **Projects**, **Notes**, and **In this chat**. Each pill shows the count for that category. The existing search now covers title, content, and type, and works on top of the active filter (both constraints applied together). A result summary line shows `Showing N of M memories` when filtered. A **Clear filters** button resets both the type filter and the search in one click. Context-aware empty states explain why nothing is showing. All edit, delete, and include operations work on filtered results as before. Filter state is not persisted — resets on page reload.
- **Edit memory notes (v1.1.0)** — each memory note in the Memory panel now has an **Edit** button. Clicking it opens an inline edit form where the user can change the type, title, and content. Saving calls `PATCH /memory/:id` which updates the record in local SQLite and sets `updated_at`. If the edited note is currently included in the active chat's context, the chip and next outgoing message immediately reflect the new title and content — no re-selection needed. Memory editing is **manual only** — no autonomous memory writes, no AI-driven edits.
- **Per-chat memory context (v1.0.0)** — memory note selection is now scoped per chat session. Switching chats restores that chat's own selection; new chats start empty; clearing context only affects the current chat. Selected IDs are stored in `localStorage` under `jarvis:memory-context-by-session` as a map keyed by session ID. Memory content never leaves local SQLite. The Memory panel, chat context chip, and Settings now all show "this chat" wording to make the scope clear.

## What Jarvis does not do (by design)

- **No cloud AI** — Jarvis is Ollama-only. OpenAI, Anthropic, Gemini, and similar services are not used at any point.
- **No autonomous file writes** — every file write requires an explicit diff preview and a manual Approve click. Nothing is ever written silently.
- **No automatic memory injection** — memory notes are only included in a chat message when you explicitly select them per chat. The model cannot read or write memory on its own. Switching chats resets the selection to that chat's own saved context.
- **No email sending** — email drafts are created as local Markdown files in `workspace/drafts/`. No email service is connected.
- **No terminal execution** — there is no shell or command runner. Jarvis cannot run system commands autonomously.
- **No Home Assistant or smart-home integration** — planned for a future milestone but not present in v1.0.0.
- **No data leaves your machine** — all AI inference (Ollama), all storage (SQLite, localStorage, workspace files), and all voice processing (browser SpeechSynthesis/SpeechRecognition) run entirely locally.

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
- **Voice is browser-only.** Mic input and TTS use the Web Speech API; no cloud speech provider is used.
- **No secrets in commits.** Use `.env` files (gitignored). See `.env.example` files.

## Current limitations

- No RAG or semantic memory — Jarvis cannot search past conversations.
- File tools are read-only — no writes, edits, or deletes yet (v0.2.3+).
- File browser shows workspace root only — no subdirectory navigation yet (v0.2.3+).
- Only one file can be attached per message — attaching a second replaces the first.
- Voice input/output uses the browser Web Speech API — not supported in Firefox.
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
| v0.5 ✓ | Voice — microphone input, text-to-speech output |
| v0.6 | Smart Home — Home Assistant integration |
| v0.7 ✓ | Project Library — read-only browser for workspace/projects/, attach file to chat |
| v0.8 ✓ | Settings Panel — read-only config/status overview; Settings nav item functional |
| v0.8.1 ✓ | Ollama model selector — browser localStorage preference, no .env writes |
| v0.8.2 ✓ | Chat model indicator — header pill shows effective model name and source |
| v0.8.3 ✓ | Per-message model stamp — each assistant bubble shows its generating model |
| v0.9 ✓ | Memory foundation — manual notes/preferences in local SQLite; no auto-injection |

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+N` | New Chat |
| `Enter` (in rename input) | Save renamed title |
| `Escape` (in rename input) | Cancel rename |

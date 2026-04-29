# Decision 049 - Attach Project Library File to Chat (v0.7.1)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.7.0 added a read-only Project Library panel. Users can browse projects and
preview files, but could not yet feed file content to Jarvis. v0.7.1 adds an
explicit one-click attachment so Jarvis can reason about a project file in the
next chat message.

## Why attachment is explicit and temporary

- **Explicit:** the user clicks "Attach to chat" — nothing is sent automatically.
- **Temporary:** the attachment clears immediately when `send()` runs. It is never
  stored in localStorage, never re-used across messages, and never included in
  the conversation history that is sent to subsequent requests.
- **Single message:** the file content appears only inside the one outgoing API
  message. Future chat turns do not carry the content unless the user attaches
  again.

This matches the same contract as the existing WorkspacePanel attachment
(introduced in v0.2.2) — keep them consistent so the behaviour is predictable.

## Why no RAG or vector DB yet

- RAG requires embedding models, a vector store, retrieval logic, and significant
  additional complexity.
- For the current use case (user selects one file and asks Jarvis about it) a
  simple context block in the message is sufficient and far simpler.
- RAG can be layered on top later without changing this flow.

## Why Project Library remains read-only

- Project Library is a reference browser, not a writable workspace.
- The "Attach to chat" button only passes already-loaded file content to the chat
  input; it never writes, edits, or deletes any file.
- The backend `/projects` routes remain unchanged — no new write endpoints added.

## How content enters the outgoing message

When `send()` runs and a project file is attached, ChatPanel builds two texts:

**`bubbleText`** (shown in the UI message bubble):
```
<user's typed message>

[Attached project file: <projectName>/<filePath>]
```

**`apiMessage`** (sent to Ollama via `/chat/stream`):
```
The user attached the following read-only project file:

Project: <projectName>
File: <filePath>

```<extension>
<file content>
```

<user's typed message>
```

The file content is prepended so the model has context before reading the
question. The UI bubble shows only the typed message and a small label —
not the raw file content.

## Why the project file pill uses indigo instead of cyan

- The existing workspace file pill uses cyan (`bg-cyan-500/10`).
- Using a distinct colour (indigo) makes it immediately clear which panel the
  attachment came from.
- Visual separation is especially useful when both attachments are active at once.

## Handling both attachment types simultaneously

A workspace file and a project file can both be attached at the same time.
The API message prepends both context blocks:

1. Workspace file block (from WorkspacePanel)
2. Project file block (from Project Library) — placed immediately before the question

Each is cleared independently when consumed.

## Safety limits

- File content originates from `GET /projects/:name/file` which already enforces
  200 KB max size, binary rejection, extension allowlist, and path traversal protection.
- The frontend does not re-fetch or re-validate the content at send time — it
  uses exactly what was returned by the safe route when the user previewed the file.
- No binary content can reach the chat input through this path.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ProjectLibraryPanel.tsx` | Added `onAttachFile` prop and "Attach to chat" button |
| `apps/web/src/components/ChatPanel.tsx` | Added `attachedProjectFile` / `onClearAttachedProjectFile` props, project file pill, updated `send()` |
| `apps/web/src/app/page.tsx` | Added `attachedProjectFile` state, wired to both panels |
| `docs/decisions/049-attach-project-file-to-chat.md` | This document |
| `README.md` | Version bumped to v0.7.1, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| Backend `/projects` routes | Unchanged |
| WorkspacePanel attachment flow | Unchanged |
| Write-with-approval flow | Unchanged |
| SQLite persistence | Unchanged |
| TTS system | Unchanged |
| Ollama integration | Unchanged |
| Project Library read-only guarantee | Unchanged |

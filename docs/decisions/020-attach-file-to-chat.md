# Decision 020 — Attach Workspace File to Chat (v0.2.2)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

v0.2.1 added a read-only workspace file browser (WorkspacePanel) that lets users list and preview files. The next step was to let users include a file's content in a chat message — user-initiated, read-only, no autonomous LLM file access.

## What was implemented

### State flow

Attachment state is lifted to `page.tsx` so WorkspacePanel (producer) and ChatPanel (consumer) can share it cleanly without sibling coupling:

- `page.tsx` owns `attachment: { path, content, size } | null`
- `handleAttachFile(path, content, size)` — called by WorkspacePanel when user clicks "Attach to chat"
- `handleClearAttachment()` — called by ChatPanel immediately when send starts

Props:
- `WorkspacePanel` receives `onAttachFile`
- `ChatPanel` receives `attachment` and `onClearAttachment`

### WorkspacePanel changes

- New prop: `onAttachFile?: (path: string, content: string, size: number) => void`
- New state: `selectedSize` (stores the size returned by `/files/read`), `attached` (boolean — tracks if the current file is attached)
- `attached` resets to `false` when a new file is selected (`handleSelectFile`)
- "Attach to chat" button appears below the preview when a file is loaded and `onAttachFile` is available
- After clicking: button is replaced with a confirmation line ("✓ Attached — will be included in your next message")

### ChatPanel changes

New props:
- `attachment?: { path: string; content: string; size: number } | null`
- `onClearAttachment?: () => void`

**Attachment pill** — shown above the textarea when `attachment` is set:
- Shows filename and "Read-only · will be included in next message"
- × button clears the attachment (calls `onClearAttachment`)

**Modified `send()`:**

1. Snapshot `attachmentSnapshot = attachment ?? null` and call `onClearAttachment?.()` immediately — attachment is consumed once and cannot be sent twice.
2. Build `bubbleText` — what the UI shows in the user message bubble:
   - With attachment: `${trimmed}\n\n[Attached: ${path}]`
   - Without: `${trimmed}`
3. Build `apiMessage` — the string sent to the API and stored in SQLite:
   - With attachment:
     ```
     The user attached the following read-only workspace file:

     File: welcome.md

     ```
     <file content>
     ```

     <typed message>
     ```
   - Without: `${trimmed}`
4. `setMessages(...)` uses `bubbleText` — users see their typed message + a small label, not the raw file dump.
5. `persistMessage(sid, "user", apiMessage)` — SQLite stores the composed message.
6. `fetch("/chat/stream", { body: { message: apiMessage, history } })` — Ollama receives the full context.

### No backend changes

The `/chat/stream` endpoint already accepts any string as `message` — no new routes, no schema changes.

## What is NOT in this phase

- No autonomous LLM file access — the model cannot request or read files on its own.
- No write, edit, delete, or move operations.
- No "ask Jarvis about this file" shortcut (deferred to v0.2.3+).
- Subdirectory navigation in WorkspacePanel (deferred to v0.2.3+).

## Known limitations

- When a session is restored from SQLite, past user messages that included an attachment will show the full composed `apiMessage` (with file content) rather than the short `bubbleText`. This is a known display inconsistency and is acceptable for now.
- Only one file can be attached at a time — attaching a second file replaces the first.

## What comes next (v0.2.3+)

- Subdirectory navigation in WorkspacePanel.
- "Ask Jarvis about this file" shortcut.
- Write-with-approval: show diff before writing, require explicit confirmation.

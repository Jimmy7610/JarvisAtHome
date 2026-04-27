# Decision 018 — New Chat Keyboard Shortcut

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

The "+ New Chat" button was the only way to start a fresh conversation. A keyboard shortcut makes the action faster and is consistent with chat-app conventions.

`Ctrl+Shift+N` was considered first but avoided — Chrome and Edge reserve it for opening an incognito/private window. `Ctrl+Alt+N` has no known browser conflict on Windows.

## What was implemented

### Shortcut: `Ctrl+Alt+N`

Registered in `page.tsx` via a `useEffect` with a `keydown` listener on `document`. The listener is cleaned up on component unmount to avoid memory leaks.

**Guards:**

- `!e.ctrlKey || !e.altKey || e.key !== "n"` — only fires on the exact combination. With Alt held (no Shift), the browser reports the key as lowercase `"n"`.
- `tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"` — skipped while the user is typing in any text field. This covers the chat input and the session rename input.
- `target.isContentEditable` — skipped inside any contenteditable element.
- `isCreatingNewChatRef.current` — a `useRef` flag, set to `true` at the start of creation and cleared in `.finally()`. Prevents key-repeat (continuous keydown events while the key is held) from creating multiple sessions.

**Behavior:** calls `handleNewChat()` — the same async function used by the "+ New Chat" button. No code duplication.

**Prevent default:** `e.preventDefault()` is called before firing to suppress any browser or OS default for that combination.

### UI hint

A small `Ctrl+Alt+N` label appears below the "+ New Chat" button in the sidebar. Styled `text-slate-700` (very dim) — visible but not distracting.

## What did NOT change

- No backend changes.
- No new dependencies.
- The `handleNewChat` function is unchanged.
- Session switching, delete, rename, and streaming are unchanged.

## Known limitations

- macOS `Cmd+Alt+N` / `Cmd+Option+N` is not wired — deferred.
- The shortcut hint is hardcoded in `SessionList.tsx` — it always shows "Ctrl+Alt+N" regardless of OS.
- The shortcut does not check whether ChatPanel is currently streaming. It calls `handleNewChat()` which creates a new session and remounts ChatPanel, aborting the in-flight request via the unmount cleanup effect (the `AbortController` in ChatPanel). This matches what happens when the user manually clicks "+ New Chat" during streaming.

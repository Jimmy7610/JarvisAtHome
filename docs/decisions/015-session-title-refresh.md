# Decision 015 — Session Title Refresh After Auto-Title

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

Decision 014 added auto-titling: the first user message triggers `PATCH /sessions/:id`, which updates the session title in SQLite. However, the `SessionList` sidebar in `page.tsx` did not refresh after that PATCH, so the sidebar kept showing "Jarvis Chat" until the user manually reloaded the page or clicked "+ New Chat".

## Goal

When `updateSessionTitle` succeeds, immediately re-fetch `GET /sessions` so the sidebar reflects the new title — without resetting the chat, without creating a duplicate session, and without interrupting streaming.

## What was changed

### `apps/web/src/components/ChatPanel.tsx`

**Signature change** — added optional `onSessionUpdated` prop:

```typescript
export default function ChatPanel({
  onSessionUpdated,
}: {
  onSessionUpdated?: () => void;
} = {}) {
```

The default `= {}` keeps the component backward-compatible: calling `<ChatPanel />` with no props still works.

**Auto-title call** — chained `.then()` to invoke the callback after the PATCH resolves:

```typescript
if (isFirstUserMessage) {
  void updateSessionTitle(sid, trimmed.slice(0, 50)).then(() => {
    onSessionUpdated?.();
  });
}
```

`updateSessionTitle` was already `async` and returned the fetch response, so the `.then()` chain required no other changes.

### `apps/web/src/app/page.tsx`

Passed the callback to ChatPanel:

```typescript
<ChatPanel
  key={activeSessionId ?? "new"}
  onSessionUpdated={() => void fetchSessions()}
/>
```

`fetchSessions()` re-fetches `GET /sessions`, updates the `sessions` state, and re-renders `SessionList`. The active session stays selected, the chat is not interrupted, and no new session is created.

## What did NOT change

- No backend changes.
- No new API endpoints.
- The `key` prop mechanism for session switching is unchanged.
- The localStorage write-through is unchanged.
- The streaming, cancel, and conversation context features are unchanged.
- The `clearChat` button behavior is unchanged.

## Known limitations

- The PATCH response is fire-and-forget from the user's perspective. If the backend is unreachable, the title stays "Jarvis Chat" in the sidebar, but the chat itself is unaffected.
- `fetchSessions()` re-fetches all 50 sessions on every auto-title. This is acceptable at the current scale.

## What comes next

- Session delete with confirmation.
- Keyboard shortcut for new chat.
- Rename session from the sidebar.

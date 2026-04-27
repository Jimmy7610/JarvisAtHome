# Decision 022 — Ask Jarvis About This File (v0.2.4)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

v0.2.2 added "Attach to chat" — the user could attach a workspace file to the next chat message, but had to type their own question. v0.2.4 adds a one-click shortcut that both attaches the file and pre-fills a suggested question in the chat input. Nothing is sent automatically; the user edits and presses Send.

## What was implemented

### State flow — same pattern as attachment

The prefilled input string is owned by `page.tsx` alongside `attachment`, so both WorkspacePanel (producer) and ChatPanel (consumer) can share it without sibling coupling.

- `page.tsx` owns `prefillInput: string | null`
- `handleAskAboutFile(path, content, size)` — sets both `attachment` and `prefillInput`
- `handleConsumePrefill()` — resets `prefillInput` to null (called by ChatPanel once it reads the value)

### WorkspacePanel changes

**New prop:** `onAskAboutFile?: (path: string, content: string, size: number) => void`

**New state:** `asked: boolean` — resets to `false` alongside `attached` whenever a new file is selected or the preview is closed.

**Button layout** (shown when file content is loaded):

| State | Display |
|---|---|
| Neither clicked | "Ask Jarvis about this file" (primary, cyan) + "Attach to chat" (secondary, muted) |
| "Attach to chat" clicked | `✓ Attached — will be included in your next message` |
| "Ask Jarvis" clicked | `✓ Queued — edit the question and press Send.` |

"Ask Jarvis about this file" is styled as the primary action (more prominent cyan); "Attach to chat" is styled as secondary (muted slate). Both are `w-full text-xs py-1.5` to fit the narrow right panel.

**`handleAsk()`** calls `onAskAboutFile` (which performs both the attach and the prefill in `page.tsx`), then sets `attached = true` and `asked = true`. It does not call `onAttachFile` separately — that would double-attach.

### ChatPanel changes

**New props:**
- `prefillInput?: string | null` — the suggested question string
- `onConsumePrefill?: () => void` — called once after the value is applied

**New `useEffect`:**

```typescript
useEffect(() => {
  if (prefillInput) {
    setInput(prefillInput);
    onConsumePrefill?.();
  }
}, [prefillInput]);
```

When `prefillInput` changes from `null` to a string, the effect fires:
1. Sets `input` to the prefilled question — appears in the textarea immediately
2. Calls `onConsumePrefill` — resets `prefillInput` to `null` in `page.tsx` so the effect cannot fire twice

The user sees the attachment pill and a pre-filled textarea. They can edit the question freely before pressing Send.

### No backend changes

No routes added or modified. The attachment content is sent via the existing `/chat/stream` composed-message format established in v0.2.2.

## What is NOT in this phase

- No automatic sending — user must press Send.
- No file writes, edits, deletes, renames, or moves.
- No multiple simultaneous attachments.
- No custom question templates — the prefill text is fixed at: `"Explain this file and suggest safe improvements."`

## Known limitations

- The prefilled question is a fixed string. It cannot be configured per file type.
- If the user clicks "Ask Jarvis" and then navigates to a different session before sending, the attachment and prefill are lost (same limitation as the existing attach flow).

## What comes next (v0.2.5+)

- Write-with-approval: show diff, require confirmation before writing any file.
- Search/filter within the workspace file list.
- Custom prefill templates per file extension.

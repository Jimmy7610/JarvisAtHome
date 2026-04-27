# Decision 027 — Chat Proposal Display and UI Polish (v0.3.3)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

v0.3.2 introduced chat-created write proposals but left the raw `jarvis-write-proposal` fenced block visible as plain assistant text. Two additional usability issues were identified: the chat input was too short to type comfortably, and the Activity Log cards were too cramped and difficult to read.

## Changes

### A — Styled write proposal callout in chat

**Problem:** The raw fenced block was displayed as monospaced code inside the assistant bubble. It was not obviously actionable and could confuse users.

**Solution:** Added `parseProposalBlock(text)` — a pure function that:
1. Runs `WRITE_PROPOSAL_REGEX` against the message text
2. If matched, extracts: text before the block, the target path from the JSON, text after the block
3. Returns `{ before, proposalPath, after }` (or `null` if no block present)

`AssistantMessage` now calls `parseProposalBlock` and, when a block is found:
- Renders any text *before* the block in a normal slate bubble
- Renders the block itself as an amber callout card showing:
  - "Jarvis proposed a workspace file change"
  - `workspace/<path>` in monospaced amber text
  - "Review the diff in the approval panel below before applying. Nothing has been written yet."
- Renders any text *after* the block in a normal slate bubble

During streaming the block is incomplete so the regex does not match — raw text is shown as before. Once the stream ends and the block is complete, the callout appears on the next render. This is correct — no special streaming handling is needed.

The approval workflow is unchanged: `detectAndPropose` still runs after stream ends, creates the pending proposal, and the amber banner + diff + Approve/Cancel buttons appear below the chat.

### B — Auto-grow chat textarea

**Problem:** `rows={1}` made the input a single line, uncomfortable for multi-line messages.

**Solution:**
- Added `textareaRef` attached to the `<textarea>`
- Added `handleInputChange(e)` — calls `setInput`, then sets `style.height = "auto"` then `Math.min(scrollHeight, 200)px` for auto-grow
- Added a `useEffect` that resets textarea height when `input` is cleared (post-send)
- Removed `rows={1}`, added `style={{ minHeight: "72px", maxHeight: "200px", overflowY: "auto" }}`
- Added `leading-relaxed` for better line spacing inside the input

Keyboard behavior unchanged: Enter sends, Shift+Enter inserts newline.

### C — Activity Log readability

**Problem:** 148px container height and `py-2` card padding left very little room for readable event cards. Long event text was cramped.

**Solutions:**
- `page.tsx`: ActivityPanel container height increased from `148px` to `200px`
- `ActivityPanel.tsx`: card padding increased to `py-2.5`; added `break-words overflow-wrap-anywhere flex-1 min-w-0` to event text paragraph so long messages wrap naturally; timestamp margin increased to `mt-1` for visual separation; badge layout cleaned up (consistent text colour, slightly more horizontal padding)

## Safety notes

- No write safety rules changed
- `parseProposalBlock` is purely display logic — it does not affect `detectAndPropose` or the approve flow
- The approval panel and buttons remain exactly as in v0.3.2

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `parseProposalBlock`, updated `AssistantMessage`, auto-grow textarea |
| `apps/web/src/components/ActivityPanel.tsx` | Card padding, text wrapping, badge spacing |
| `apps/web/src/app/page.tsx` | ActivityPanel container height 148px → 200px |

# Decision 072 — Multi-file Proposal Validation UI (v1.2.2)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

v1.2.0 added the multi-file write proposal flow (v2 format).  v1.2.1 added a
template helper.  v1.2.2 improves the pending-approval UI with pre-approval
metadata so the user can review what they are about to approve at a glance,
without having to scroll through every diff.

## Changes

### Stats row (multi-file banner header)

A compact line is shown above the per-file sections:

```
3 files · 2 create · 1 update · 4.7 KB total
```

- File count is the length of `chatMultiProposals`.
- Create / update counts are derived from `proposal.operation`.
- Total size is the sum of `proposal.content.length` across all files, formatted
  by the new `formatContentSize()` helper (`B` below 1 KB, `KB` above).

### Advisory warnings

`computeMultiProposalWarnings()` runs over the proposals array and returns a
list of `{key, message}` entries for two conditions:

1. **Duplicate paths** — two or more proposals target the same
   `workspace/`-relative path (case-insensitive, slash-normalised).
   Message: `Duplicate path: files N and M both target workspace/<path>`.

2. **Empty content** — a proposal's content is blank or whitespace only.
   Message: `File N (<path>) has empty content`.

Warnings are shown as amber `⚠` lines below the stats row.
They are **advisory only** — the "Approve all" button is never blocked.
Backend validation (`approveWrite`) is the authoritative safety layer.

### Per-file metadata improvements

Each file section header row now shows:

- **Path** — `workspace/<path>` (truncated with `flex-1 truncate`)
- **Operation badge** — `new file` (green) for `create`; `update` (muted grey)
  for `edit`.  Replaces the previous single amber badge.
- **Content size** — formatted byte count (e.g. `84 B`, `1.2 KB`) in muted
  mono text.
- **File counter** — `N/M` in very muted text for orientation.

The diff body and Approve all / Cancel buttons are unchanged.

## Helper functions (module-level, pure)

### `formatContentSize(bytes: number): string`

```typescript
function formatContentSize(bytes: number): string {
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
```

Uses `content.length` (character count) rather than a `TextEncoder` — valid
for the ASCII-dominant workspace files Jarvis writes; avoids importing a DOM
API in a potentially server-rendered module.

### `computeMultiProposalWarnings(proposals): MultiProposalWarning[]`

Pure function — no side effects, no state reads.  Called inline during render;
result is not cached (proposals are small, recompute is cheap).

## Safety contract

- **No new write paths** — UI only; no changes to `proposeWrite` or
  `approveWrite`.
- **Approval still required** — warnings never disable the Approve button.
- **No autonomous actions** — no API calls triggered by the stats row.
- **Backend is authoritative** — duplicate path and empty content are also
  rejected server-side; the UI warnings are a convenience, not a gate.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `formatContentSize()`, `MultiProposalWarning`, `computeMultiProposalWarnings()` added; multi-file banner updated with stats row, warnings, better per-file badges and size |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.2.2"` |
| `apps/web/src/app/page.tsx` | sidebar footer → `v1.2.2 — multi-file validation` |
| `apps/web/src/components/SettingsPanel.tsx` | version fallbacks → `"1.2.2"`; Multi-file proposal validation UI row in Feature Status |
| `README.md` | heading → v1.2.2; multi-file validation UI feature bullet |
| `docs/decisions/072-multi-file-proposal-validation-ui.md` | This document |

## What is NOT changed

- No new backend endpoints
- No database schema changes
- No changes to `proposeWrite` or `approveWrite` logic
- No changes to v1 single-file proposal flow
- JarvisBrain — untouched

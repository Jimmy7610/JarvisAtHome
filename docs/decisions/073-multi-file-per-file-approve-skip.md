# Decision 073 — Per-file Approve/Skip for Multi-file Proposals (v1.2.3)

**Date:** 2026-05-01
**Status:** Accepted and implemented

## Context

v1.2.0 introduced multi-file write proposals with an "Approve all N files" button.
v1.2.2 added a validation UI with stats and warnings.  v1.2.3 gives the user
fine-grained control: each file can be individually included or skipped before
clicking Approve.

## Design goals

- **Default safe** — all files start as included so existing "approve everything"
  behaviour is preserved for users who want it.
- **No new write paths** — skipped files are simply omitted from the sequential
  `/files/approve-write` loop; no new endpoint, no bypass, no batch write.
- **Advisory, not mandatory** — the Include/Skip toggle is a convenience layer;
  backend validation on `/files/approve-write` is still the authoritative guard.
- **Single-file unchanged** — the toggle only appears in the multi-file banner.

## State

### `selectedMultiProposalIds: Set<string>`

A `Set` of proposal IDs the user has included.

| Event | Action |
|---|---|
| New multi-file proposal detected (`detectAndPropose`) | Initialised to all file IDs |
| User clicks Include/Skip toggle | ID added or removed from the Set |
| `handleChatCancelProposal` called | Cleared to empty Set |
| Approve completes successfully | Cleared to empty Set |
| New `send()` called | Cleared to empty Set |
| Banner dismiss button clicked | Cleared to empty Set |

Using a `Set` rather than an array means membership checks in the render loop
are O(1) regardless of file count.

## UI

### Stats row (updated)

```
3 files · 2 selected · 1 skipped · 2 create · 0 update · 1.2 KB selected
```

- `selected` and `skipped` counts reflect the current toggle state.
- `create` / `update` counts are computed over the **selected** subset.
- `KB selected` is the total content size of **selected** files only.
- When nothing is skipped the `skipped` segment is omitted to keep the row compact.

### Per-file toggle

Each file section header gains an **✓ Include** / **Skip** button as the
leftmost element.  The button style flips on hover to hint at the opposite action:

| State | Style | Hover hint |
|---|---|---|
| Included | green background | shows red on hover (click to skip) |
| Skipped | muted grey | shows green on hover (click to include) |

The entire file section (header + diff) has `opacity-40` when skipped, making
skipped files visually subordinate without hiding the diff entirely.

### All-skipped warning

When `selectedCount === 0`, an amber warning appears:

> No files selected. Toggle at least one file to Include before approving.

The Approve button is disabled (`disabled` attribute) in addition to the warning.

### Approve button label

`Approve selected M files` where M is the current selection count.

### Warnings (v1.2.2 advisory warnings)

`computeMultiProposalWarnings()` now receives only the **selected** proposals.
Skipped files are ignored — duplicate path and empty content warnings apply only
to what will actually be written.

## Approve behaviour

`handleApproveAll()` filters `chatMultiProposals` by `selectedMultiProposalIds`
before iterating.  Only selected proposals are passed to `POST /files/approve-write`.
Skipped proposals are never touched.

Activity log on success:
- All selected, none skipped: `Chat write approved: 2 files written`
- Some skipped: `Chat write approved: 2 of 3 files written (1 skipped)`

## Safety contract

- **No new backend endpoints** — uses existing `/files/propose-write` and
  `/files/approve-write` unchanged.
- **No batch write** — sequential loop per selected file, stops on first failure.
- **Approval still required** — the toggle changes which files enter the approval
  loop; it does not bypass the approval step.
- **Backend validates every write** — path traversal, workspace sandbox, and
  content checks run on each `/files/approve-write` call regardless of the frontend
  selection state.
- **No autonomous actions** — nothing is written without the user clicking Approve.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `selectedMultiProposalIds` state; init in `detectAndPropose`; clear in `send`, cancel, dismiss, approve; `handleApproveAll` filters by selection; multi-file banner updated with toggle, stats, all-skipped warning, new approve button label |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.2.3"` |
| `apps/web/src/app/page.tsx` | sidebar footer → `v1.2.3 — per-file approve/skip` |
| `apps/web/src/components/SettingsPanel.tsx` | version fallbacks → `"1.2.3"`; Per-file approve/skip row in Feature Status |
| `README.md` | heading → v1.2.3; per-file approve/skip feature bullet |
| `docs/decisions/073-multi-file-per-file-approve-skip.md` | This document |

## What is NOT changed

- No new backend endpoints
- No database schema changes
- No changes to propose-write or approve-write logic
- Single-file (v1) proposal flow — completely unchanged
- JarvisBrain — untouched

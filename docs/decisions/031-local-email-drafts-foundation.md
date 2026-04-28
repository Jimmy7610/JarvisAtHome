# Decision 031 — Local Email Drafts Foundation (v0.4.0)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

v0.3.x delivered a working write-with-approval flow: the assistant can propose a workspace file write, the user sees a diff, and clicks Approve before anything is written. The planned v0.4 milestone adds email draft support. Rather than building an entirely new system, email drafts are implemented as a thin layer on top of the existing write proposal flow — no new backend endpoints, no new UI components, no email service connections.

## Design

Email drafts are **local Markdown files saved under `workspace/drafts/`**. The mechanism is identical to any other workspace file proposal:

1. User asks Jarvis to write an email draft
2. Jarvis outputs a `jarvis-write-proposal` fenced block (or bare JSON, caught by the fallback) targeting `drafts/<subject-slug>.md`
3. Frontend detects the block, calls `POST /files/propose-write`
4. Backend validates the path (must be inside `workspace/`), computes a diff, returns a proposal ID
5. UI shows the amber callout, pending approval panel, and diff
6. User clicks **Approve write** → `POST /files/approve-write` → file is written
7. Draft appears under `workspace/drafts/` and is browsable via Workspace Files

Nothing is sent. There is no "Send" button, no email service connection, no credentials.

## Changes

### `apps/api/src/services/ollama.ts`

Added a `## Local email drafts` section to `JARVIS_SYSTEM_PROMPT` after the workspace file proposals rules. The new section:

- Instructs Jarvis to treat email requests as local Markdown draft proposals
- Specifies the default path pattern: `drafts/<subject-slug>.md`
- Provides the Markdown file format (heading, To:, Subject:, body, sign-off)
- Includes six hard rules:
  - NEVER send emails
  - NEVER ask for credentials
  - NEVER mention email services (Gmail, Outlook, SMTP, SendGrid, …)
  - NEVER claim the email was or will be sent
  - The draft is only written after user Approve
  - If asked to send, explain the limitation and offer a local draft instead

### `apps/web/src/components/ChatPanel.tsx`

Added a small **"email draft"** badge to the pending write approval banner header. The badge is shown when `chatProposal?.path.startsWith("drafts/")` is true — i.e., while the proposal is in the pending state (before Approve or Cancel). It uses the existing cyan accent style to be visually distinct without introducing a new design token.

The badge disappears after Approve (when `chatProposal` is cleared and `chatWriteSuccess` is set) or after Cancel. Neither state change required new state variables.

### `workspace/drafts/`

Already existed — no filesystem change needed.

### `README.md`

- Version heading updated to v0.4.0
- v0.4.0 bullet added
- Safety rule updated from "planned" to "implemented"
- Milestones table row marked ✓

## What is explicitly NOT included

| NOT included | Reason |
|---|---|
| Gmail / SMTP / Outlook connection | Out of scope — local-only by design |
| OAuth or credential storage | No email provider needed |
| Send button | Nothing should be sent automatically |
| Email inbox reading | Not planned for this milestone |
| Email scheduling | Not planned for this milestone |
| New backend endpoint for email | Existing `/files/propose-write` + `/files/approve-write` are sufficient |
| New frontend email UI | The existing proposal panel is sufficient for v0.4 |

## Safety notes

- Backend workspace path validation is unchanged — drafts must be inside `workspace/`
- The `drafts/` subdirectory already exists and is inside the sandboxed workspace
- Write-with-approval is unchanged — nothing is written without an explicit Approve click
- The system prompt cannot force the model to send emails — there is no send endpoint

## Files changed

| File | Change |
|---|---|
| `apps/api/src/services/ollama.ts` | `JARVIS_SYSTEM_PROMPT` — added `## Local email drafts` section |
| `apps/web/src/components/ChatPanel.tsx` | Added "email draft" badge to pending approval banner |
| `README.md` | Version bump, v0.4.0 bullet, safety rule update, milestone marked ✓ |
| `docs/decisions/031-local-email-drafts-foundation.md` | This document |

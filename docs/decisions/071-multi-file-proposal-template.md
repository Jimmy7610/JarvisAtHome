# Decision 071 — Multi-file Proposal Template Helper (v1.2.1)

**Date:** 2026-04-30
**Status:** Accepted and implemented

## Context

v1.2.0 introduced the v2 multi-file write proposal format, but using it required
the user or model to remember the exact JSON structure.  v1.2.1 adds two pieces
of guidance:

1. **UI template button** — a "Copy multi-file template" button in ChatPanel that
   puts a ready-to-edit v2 proposal block on the clipboard.
2. **System prompt hint** — a short v2 format section appended to
   `JARVIS_SYSTEM_PROMPT` in `ollama.ts` so the local Ollama model knows the format
   without being prompted explicitly.

Neither change adds new write capability or bypasses approval.

## Safety contract

- **No new write paths** — the template button only copies text to the clipboard
  (or inserts it into the input as a fallback).  No file is written.
- **Approval still required** — pasted proposals go through the existing
  `send()` interception → `detectAndPropose()` → `handleApproveAll()` flow.
  The user must click "Approve all" or "Approve write" before any write occurs.
- **No autonomous actions** — the button does not send the template to Ollama or
  trigger any API call.
- **Safe example paths** — the template uses `sandbox/example-1.md` and
  `welcome.md`; no absolute paths, no traversal sequences.
- **Model hint is advisory only** — the system prompt addition tells the model
  the format; it does not relax any validation or bypass the approval step.

## UI — "Copy multi-file template" button

**Location:** Below the chat input, on the right side of the
"Enter to send · Shift+Enter for new line" row.

**Behaviour:**
1. Click → `navigator.clipboard.writeText(template)`.
2. On success: label changes to `"✓ Template copied"` for 2 s, then resets.
   Activity Log: `"Multi-file proposal template copied to clipboard"`.
3. On clipboard failure (non-HTTPS, permission denied): template is inserted
   directly into the chat input and the textarea auto-resizes.
   Activity Log: `"Multi-file proposal template inserted into input (clipboard unavailable)"`.
4. Nothing is sent automatically.

**Template:**
```jarvis-write-proposal
{
  "type": "workspace_write_proposal",
  "version": 2,
  "summary": "Describe the intended changes",
  "files": [
    {
      "operation": "create",
      "path": "sandbox/example-1.md",
      "content": "# Example 1\n"
    },
    {
      "operation": "update",
      "path": "welcome.md",
      "content": "# Updated welcome\n"
    }
  ]
}
```

## System prompt hint

A short section is appended to `JARVIS_SYSTEM_PROMPT` in
`apps/api/src/services/ollama.ts`:

```
## Multi-file workspace proposals (v2)

When the user asks to create or update MULTIPLE files at once, respond with a v2 proposal block:
```jarvis-write-proposal
{"type":"workspace_write_proposal","version":2,"summary":"Brief description","files":[...]}
```

v2 rules: operation must be 'create' or 'update'. Maximum 5 files per proposal.
No delete operation. User must click 'Approve all' before any file is written.
For a single file, use the v1 format (path + content only).
```

The hint is intentionally compact — it does not duplicate the full v1 rules or
add new restrictions.  The existing approval and validation logic is unchanged.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `templateCopied` state; `handleCopyMultiFileTemplate()` handler; "Copy multi-file template" button in the input footer row |
| `apps/api/src/services/ollama.ts` | v2 multi-file hint appended to `JARVIS_SYSTEM_PROMPT` |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.2.1"` |
| `apps/web/src/app/page.tsx` | sidebar footer → `v1.2.1 — multi-file template` |
| `apps/web/src/components/SettingsPanel.tsx` | version fallbacks → `"1.2.1"`; Multi-file proposal template helper row in Feature Status |
| `README.md` | heading → v1.2.1; multi-file template helper feature bullet |
| `docs/decisions/071-multi-file-proposal-template.md` | This document |

## What is NOT changed

- No new backend endpoints
- No database schema changes
- No automatic writes
- No new approval paths — existing single-file and multi-file approval flows unchanged
- JarvisBrain — untouched

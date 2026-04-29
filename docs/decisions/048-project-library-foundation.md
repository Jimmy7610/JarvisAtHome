# Decision 048 - Project Library Foundation (v0.7.0)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

Jarvis users need a way to browse and read reference projects stored locally —
architecture documents, code snippets, notes, and other text files that Jarvis
should be able to reason about. The Workspace Files panel already handles the
`workspace/` sandbox, but it is oriented toward active drafts and files Jarvis
creates. A separate Project Library is needed for reference material that the
user browses themselves.

## Approved root

```
workspace/projects/
```

This is a fixed subdirectory of `config.allowedWorkspace`. It cannot be
redirected by environment variable — only the workspace root itself can be
overridden. The projects root is never created automatically; it must exist
before the API responds with project listings.

## Why a separate panel instead of extending WorkspacePanel

- WorkspacePanel is already complex (breadcrumb navigation, write proposals,
  diff display, attachment flow, openFileRequest communication).
- Project Library needs recursive file listing (not just one level deep).
- Projects have a different access pattern: pick a project, then browse files.
- Keeping them separate makes each component simpler and reviewable.

## API design

Three read-only routes, all returning `{ ok: boolean, ... }`:

| Route | Description |
|---|---|
| `GET /projects` | List all project directories in `workspace/projects/` |
| `GET /projects/:projectName` | List readable files inside a project (recursive) |
| `GET /projects/:projectName/file?path=...` | Read a single text file |

All routes are sandboxed via `resolveProjectDir()` and `resolveProjectFilePath()`
which use `path.resolve()` + `startsWith()` guards — identical pattern to
`resolveWorkspacePath()` in `fileTools.ts`.

## Allowed file extensions

`.md .txt .json .ts .tsx .js .jsx .mjs .cjs .css .html .htm .yml .yaml .sh .ps1`

Binary files, compiled output, images, audio, and unknown extensions are
silently excluded from listings and rejected on direct read.

## Skipped directories

`node_modules .git .next dist build local-tts .turbo coverage out .cache`

These are never traversed during recursive listing.

## Limits

| Limit | Value |
|---|---|
| Max files per project | 500 |
| Max file size | 200 KB |
| Max binary check | First 512 bytes (null-byte heuristic) |

## Frontend

`ProjectLibraryPanel` follows the same structure as WorkspacePanel:

- Three internal views: `projects`, `files`, `file`
- Breadcrumb header with back-navigation at each level
- Refresh button
- Loading / error states
- Activity log events via `onActivity` prop

The panel is mounted in `page.tsx` below WorkspacePanel in the right sidebar.
WorkspacePanel gets a fixed 280 px height; ProjectLibraryPanel takes the
remaining space (`flex-1 min-h-0`).

## What is NOT in v0.7.0

- No "Attach to chat" from Project Library (planned for a future milestone).
- No search across project files.
- No RAG or semantic indexing.
- No write support (Project Library is read-only by design for this milestone).
- No "Ask Jarvis about this file" from Project Library.

## Files changed

| File | Change |
|---|---|
| `apps/api/src/services/projectTools.ts` | New - project library backend service |
| `apps/api/src/routes/projects.ts` | New - GET /projects, /projects/:name, /projects/:name/file |
| `apps/api/src/index.ts` | Added projects router import and mount |
| `apps/web/src/components/ProjectLibraryPanel.tsx` | New - frontend panel |
| `apps/web/src/app/page.tsx` | Added ProjectLibraryPanel to right sidebar, version bump |
| `workspace/projects/example-project/README.md` | New - example project |
| `docs/decisions/048-project-library-foundation.md` | This document |
| `README.md` | Version bumped to v0.7.0, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| WorkspacePanel | Unchanged (height adjusted to 280 px fixed) |
| Write-with-approval flow | Unchanged |
| Chat panel | Unchanged |
| Ollama integration | Unchanged |
| TTS system | Unchanged |
| SQLite persistence | Unchanged |

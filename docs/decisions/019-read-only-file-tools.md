# Decision 019 — Read-Only File Tools (v0.2.1)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

Jarvis v0.1 had no file access. v0.2.1 adds the first file capability: read-only listing and reading of files inside a dedicated sandbox workspace directory. No writes, edits, deletes, or moves exist in this phase.

## What was implemented

### Workspace sandbox

A single allowed workspace directory is the only location Jarvis file tools can access:

```
C:\Users\Jimmy\Documents\GitHub\Jarvis\workspace
```

Configured via `JARVIS_ALLOWED_WORKSPACE` env var (defaults to `<project-root>/workspace`). The value is resolved to an absolute path at startup via `path.resolve()` so relative paths in the env var work correctly.

### Backend service — `apps/api/src/services/fileTools.ts`

Four exported functions, all sandboxed:

**`getAllowedWorkspace()`** — returns the absolute workspace path from config.

**`resolveWorkspacePath(relativePath)`** — the core security function. Resolves the caller's relative path against the workspace root and checks that the result starts with `<workspace>/`. Throws `"Path is outside the allowed workspace."` for any escape attempt, including `../`, absolute paths, or Windows-style `C:\...` paths.

**`listFiles(relativePath?)`** — reads a directory and returns sorted `FileEntry[]`. Skips:
- Hidden entries (names starting with `.`)
- Known heavy/unsafe directories: `node_modules`, `.git`, `.next`, `dist`, `build`, `data`, `.turbo`, `coverage`, `out`
- Broken symlinks (stat errors are silently skipped)

Results are sorted directories-first, then alphabetically within each group.

**`readTextFile(relativePath)`** — reads a file. Enforces:
- Path must be inside workspace (via `resolveWorkspacePath`)
- File must exist and be a regular file
- File size must be ≤ 200 KB
- File must not be binary (checked by scanning the first 512 bytes for null bytes — a reliable heuristic for text vs binary)

Returns `{ content: string; size: number }`.

### Backend routes — `apps/api/src/routes/files.ts`

Mounted at `/files`. Both routes return HTTP 200 always; `ok` field signals success (consistent with all other Jarvis routes).

**`GET /files/list?path=optional`**
```json
{
  "ok": true,
  "root": "workspace",
  "path": "",
  "entries": [
    { "name": "welcome.md", "path": "welcome.md", "type": "file", "size": 512 },
    { "name": "drafts", "path": "drafts", "type": "directory" }
  ]
}
```

**`GET /files/read?path=relative-path`**
```json
{ "ok": true, "path": "welcome.md", "content": "...", "size": 512 }
```

On error:
```json
{ "ok": false, "error": "Path is outside the allowed workspace." }
```

### Frontend — `WorkspacePanel.tsx`

A new panel added to the bottom of the right sidebar, below the activity log. Shows:
- "Workspace Files" header with a "Read-only" badge.
- Scrollable file/directory listing fetched from `GET /files/list`.
- Clicking a file name reads and previews the content via `GET /files/read`.
- A close (×) button dismisses the preview.
- Directories are displayed but not clickable (navigation into subdirectories deferred to v0.2.2).
- File sizes shown in compact form (B / KB / MB).

### Config change — `apps/api/src/config.ts`

Added `allowedWorkspace` field. The path is resolved once at startup from the env var or the default, making it safe to compare against resolved request paths.

## Path traversal protection — how it works

The `resolveWorkspacePath` function uses `path.resolve(workspace, cleanedInput)`. Node's `path.resolve` collapses `..` segments, so `path.resolve("/safe/workspace", "../../etc/passwd")` returns `/etc/passwd`. The function then checks:

```typescript
if (resolved !== workspace && !resolved.startsWith(workspaceWithSep)) {
  throw new Error("Path is outside the allowed workspace.");
}
```

This catches:
- `../README.md` → resolves to project root → rejected
- `/etc/passwd` → absolute path, still resolved → rejected if outside workspace
- `C:\Windows\system32\...` → resolves to absolute Windows path → rejected
- `subdir/../../outside` → resolves above workspace → rejected

## What is NOT in this phase

- No file writes.
- No file edits or diffs.
- No file deletes, moves, or renames.
- No LLM autonomous file reading — the model cannot call file tools on its own.
- No "attach file to prompt" — that is v0.2.2.
- No directory navigation in the UI (subdirectory click) — deferred.

## Known limitations

- Binary detection is a null-byte heuristic, not MIME type detection. Some text files with unusual encoding (e.g. UTF-16) may be incorrectly flagged as binary.
- Directory listing is flat (root only in the UI). Navigating into subdirectories requires a future update.
- No auto-refresh — the file list is loaded once on panel mount.

## What comes next (v0.2.2)

- Subdirectory navigation in the UI.
- "Attach file to chat" — let the user select a file and include its content in the next prompt.
- Possibly: "Ask Jarvis about this file" shortcut that pre-fills the chat input.

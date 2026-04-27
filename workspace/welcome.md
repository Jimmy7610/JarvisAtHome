# Jarvis Workspace

This is the Jarvis workspace — a safe sandbox directory that Jarvis can read.

## What is this?

The workspace is the only directory Jarvis has permission to read in v0.2.
No files outside this directory can be accessed by the file tools.

## Subdirectories

- `drafts/` — text drafts, notes, prompt templates
- `projects/` — project context files, specs, plans
- `sandbox/` — scratch files for experimentation

## Rules

- Jarvis can read files here.
- Jarvis cannot write, edit, delete, or move files yet.
- File writes are planned for v0.2.2 with explicit user approval.
- No file outside this workspace directory is accessible via Jarvis file tools.

## Path traversal protection

Any attempt to read `../` paths or absolute paths outside this workspace
is rejected by the API with `{ "ok": false, "error": "Path is outside the allowed workspace." }`.

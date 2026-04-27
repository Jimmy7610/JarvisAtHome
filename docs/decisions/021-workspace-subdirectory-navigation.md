# Decision 021 — Workspace Subdirectory Navigation (v0.2.3)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

v0.2.1 added a read-only workspace file browser that listed only the root of the workspace directory. v0.2.2 added attach-to-chat. v0.2.3 adds subdirectory navigation so users can click into `drafts/`, `projects/`, `sandbox/`, and any nested folders inside the allowed workspace.

## What was implemented

### Backend — no changes required

The existing `GET /files/list?path=optional-relative-path` endpoint already accepts a relative directory path and passes it to `listFiles(relativePath)` in `fileTools.ts`. The `resolveWorkspacePath()` path traversal guard is already applied, so all the safety properties from v0.2.1 hold for subdirectories too:

- `../` traversal → rejected
- Absolute paths → rejected
- Paths outside workspace → rejected

### Frontend — `WorkspacePanel.tsx` updated

**New state:**

- `currentPath: string` — the relative directory path currently being browsed (`""` = workspace root).

**New helper `buildBreadcrumbs(dirPath)`:**

Converts a relative path string into an array of `{ label, path }` segments for display. For example `"drafts/notes"` becomes:
```
[{ label: "workspace", path: "" }, { label: "drafts", path: "drafts" }, { label: "notes", path: "drafts/notes" }]
```

**New `navigateTo(dirPath)` function:**

- Sets `currentPath` to the target directory.
- Clears the file preview if the currently selected file does not live directly inside the target directory:
  - Root (`dirPath === ""`): clears if `selectedPath` contains a `/` (i.e., is inside a subdirectory).
  - Subdirectory: clears if `selectedPath` does not start with `dirPath + "/"`.

**New `navigateUp()` function:**

Strips the last segment from `currentPath` and calls `navigateTo`. No-op at root.

**Breadcrumb navigation bar** (shown between header and file list):

- Up arrow (`↑`) button appears when not at root — navigates up one level.
- Breadcrumb segments are rendered inline. All segments except the last are clickable buttons that navigate to that level. The last segment (current directory) is plain text.
- Layout is compact (`py-1.5`) to fit the narrow right panel.

**Directory entries are now clickable:**

Previously directories were non-interactive `<div>` elements. Now they are `<button>` elements that call `navigateTo(entry.path)` when clicked.

**`fetchList(dirPath)`:**

Now accepts a `dirPath` argument and builds the correct query string. A `useEffect` on `[currentPath]` calls `fetchList(currentPath)` whenever the directory changes.

**Empty state message:**

Shows "No files in workspace yet." at root and "Empty folder." inside subdirectories.

**`maxHeight` for file list** reduced from `140px` to `120px` to accommodate the breadcrumb bar without growing the panel.

### Attach-to-chat — unchanged

The existing attach-to-chat behavior is fully preserved. File paths inside subdirectories (e.g., `drafts/notes.md`) work as expected.

## What is NOT in this phase

- No file writes, edits, deletes, renames, or moves.
- No terminal execution.
- No autonomous LLM directory traversal.
- No search/filter within the file list.
- No sorting controls.

## Known limitations

- The file list does not auto-refresh. Changes to the workspace directory made externally require a page reload or navigating away and back.
- The panel height is fixed — very deep directory trees with many files may require scrolling.

## What comes next (v0.2.4+)

- Write-with-approval: show diff before writing, require explicit user confirmation.
- "Ask Jarvis about this file" shortcut that pre-fills the chat input.
- Search/filter within the workspace file list.

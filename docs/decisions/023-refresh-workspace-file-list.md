# Decision 023 — Refresh Workspace File List (v0.2.5)

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

After v0.2.3 added subdirectory navigation, the file listing was loaded once on mount (or on each directory change). If files were added or changed externally, the user had to navigate away and back to see the updated listing. v0.2.5 adds a small manual refresh button to reload the current folder in place.

## What was implemented

### Frontend — `WorkspacePanel.tsx` only. No backend changes.

**`fetchList` return type changed from `Promise<void>` to `Promise<FileEntry[]>`**

The function now returns the fetched entries so callers can inspect them. On error it returns `[]`. The `useEffect` that calls `fetchList(currentPath)` on directory change uses `void` to discard the return value — no behaviour change there.

**New `refreshWorkspace()` function:**

```typescript
async function refreshWorkspace(): Promise<void> {
  const newEntries = await fetchList(currentPath);
  if (selectedPath !== null) {
    const stillExists = newEntries.some(
      (e) => e.type === "file" && e.path === selectedPath
    );
    if (!stillExists) closePreview();
  }
}
```

- Reloads `currentPath` — the directory the user is currently viewing.
- After the fetch completes, checks whether the currently previewed file (`selectedPath`) still appears in the new listing.
- If the file is gone, calls `closePreview()` which clears `selectedPath`, `fileContent`, `fileError`, `attached`, and `asked`.
- If the file still exists, the preview, attach state, and ask state are all preserved.

**Refresh button added to the panel header:**

```tsx
<button
  onClick={() => void refreshWorkspace()}
  disabled={listLoading}
  className={`... ${listLoading ? "animate-spin" : ""}`}
  title="Refresh file list"
  aria-label="Refresh"
>
  ↻
</button>
```

- Sits between the "Workspace Files" title and the "Read-only" badge.
- Disabled while `listLoading` is true (prevents concurrent fetch requests).
- Spins (`animate-spin`) while the fetch is in progress — reuses the existing `listLoading` state as the loading indicator.
- The file list area already shows "Loading…" during any fetch, so no additional loading state is needed.

## Invariant preserved

`refreshWorkspace` checks for `selectedPath` using the closure value at call time. Because `navigateTo` already ensures that `selectedPath` is always a direct child of `currentPath` when non-null, the check `newEntries.some(e => e.type === "file" && e.path === selectedPath)` is always comparing against entries from the correct directory.

## What is NOT in this phase

- No auto-refresh on a timer — manual only.
- No file system watcher.
- No write, edit, delete, rename, or move operations.
- No terminal execution.

## Known limitations

- Changes made externally between two manual refreshes are not visible until the user clicks Refresh.
- The listing is not automatically refreshed after attaching or asking about a file.

## What comes next (v0.2.6+)

- Write-with-approval: show diff before writing any file, require explicit user confirmation, log all write activity.
- Search/filter within the workspace file list.

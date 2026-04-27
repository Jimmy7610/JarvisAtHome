# Decision 029 — Right Sidebar Activity Log Layout Fix

**Date:** 2026-04-27  
**Status:** Accepted and implemented

## Context

After v0.3.4 the Activity Log was receiving write/cancel events but they were hard to see. The Workspace Files panel visually dominated the right sidebar, and the Activity Log area did not scroll reliably. The root cause was two CSS flex bugs in the sidebar layout.

## Root causes

### Bug 1 — ActivityPanel wrapper was not a flex container

`page.tsx` wrapped ActivityPanel in:

```jsx
<div className="flex-none" style={{ height: "200px", overflow: "hidden" }}>
  <ActivityPanel ... />
</div>
```

`flex-none` controls how this element behaves in its parent flex column — it does **not** make the element itself a flex container. ActivityPanel's root has `flex-1 flex flex-col overflow-hidden`, and its inner event list has `flex-1 overflow-y-auto`. For `flex-1` to work, the parent must be a flex container with a defined height. Since the wrapper was not a flex container, `flex-1` had no effect on ActivityPanel: the component rendered at its full natural height (all event cards stacked), and the outer `overflow: hidden` silently clipped any content past 200 px. The inner `overflow-y-auto` never became a scroll area because the inner list also never got a bounded height from `flex-1`.

### Bug 2 — WorkspacePanel had no flex bounds in the sidebar

WorkspacePanel was a direct flex child of the right sidebar `aside` with no `flex-1` or `min-h-0` applied. In CSS flex, the default is `flex: 0 1 auto` — the element uses its natural content height. Without `min-h-0`, a flex child cannot shrink below that natural height even when the container is smaller. This meant WorkspacePanel could overflow the sidebar (silently clipped by `overflow-hidden`), and it was not correctly confined to the space remaining after StatusPanel and ActivityPanel.

## Changes

### `apps/web/src/app/page.tsx`

**ActivityPanel wrapper:** added `flex flex-col` so the 240 px container is now a flex container. This makes ActivityPanel's `flex-1` root correctly fill the full 240 px, and the inner event list's `flex-1 overflow-y-auto` gains a bounded height and scrolls properly. Height increased from 200 px to 240 px for a bit more visible area (~3–4 event cards before scrolling).

**WorkspacePanel wrapper:** wrapped in `<div className="flex-1 min-h-0 overflow-hidden">`. `flex-1` makes it fill all remaining sidebar height after StatusPanel (natural height) and ActivityPanel (fixed 240 px). `min-h-0` overrides the browser default of `min-height: auto`, which is required for a flex child containing scrollable content to shrink below its content height.

### `apps/web/src/components/WorkspacePanel.tsx`

Root div: added `h-full` so WorkspacePanel fills its new `flex-1` wrapper completely. Without this, the component would use its natural height inside the wrapper, which could be shorter than the available space (leaving an empty gap) or taller (overflowing).

## Result

At a 1600×900 screen with Ollama online and one model installed (StatusPanel ≈ 260 px):

- Activity Log: 240 px, scrollable, shows ~3–4 event cards before scrolling
- Workspace Files: remaining ~400 px, fully bounded, internal sections scroll as before
- No overlap, no clipping of either panel

## Safety notes

- No backend changes
- No write safety rules changed
- All existing WorkspacePanel features (refresh, navigation, preview, attach, ask, propose, approve) unchanged — only the root div got `h-full`

## Files changed

| File | Change |
|---|---|
| `apps/web/src/app/page.tsx` | ActivityPanel wrapper: add `flex flex-col`, height 200→240 px; WorkspacePanel: add `flex-1 min-h-0 overflow-hidden` wrapper |
| `apps/web/src/components/WorkspacePanel.tsx` | Root div: add `h-full` |
| `docs/decisions/029-right-sidebar-activity-layout.md` | This document |

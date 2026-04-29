# Decision 053 - Right Sidebar Tabs (v0.7.5)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

By v0.7.4 the right sidebar stacked four panels vertically inside a fixed
288px-wide column:

- System Status (~180-220px)
- Activity Log (240px fixed)
- Workspace Files (280px fixed)
- Project Library (remaining ~120-160px)

At 900px screen height, Workspace Files had 280px and Project Library had fewer
than 160px.  With search, file preview, and action buttons, both panels felt
unusable: text wrapped, previews were cramped, and Activity Log entries were
hard to read.

## Solution

Replace the vertical stack with a compact 4-tab bar so only one panel is shown
at a time.  Each panel gets the full remaining sidebar height (~830px at 900px
screen height vs. the previous 160-280px).

## Why tabs instead of an accordion or split

- Tabs are the most common pattern for switching between equal-priority panels
  in a fixed-width sidebar.
- No panel "owns" more importance than another — all four are peer tools.
- A single row of 4 short-label tabs (Status / Activity / Workspace / Projects)
  fits the 288px width at `text-xs` without overflow.
- An accordion would let panels fight for height; a split would still leave
  each half too small.

## Implementation — page.tsx only

All four panel components (`StatusPanel`, `ActivityPanel`, `WorkspacePanel`,
`ProjectLibraryPanel`) are unchanged.  Only the right `<aside>` in `page.tsx`
was modified:

```tsx
<aside className="w-72 flex-shrink-0 flex flex-col overflow-hidden bg-[#0d1120]">
  {/* Tab bar */}
  <div className="flex-shrink-0 flex">
    {tabs.map(({ id, label }) => (
      <button
        key={id}
        onClick={() => setRightTab(id)}
        className={active ? "... border-cyan-500" : "... border-slate-800"}
      >
        {label}
      </button>
    ))}
  </div>

  {/* Content area — flex-1 min-h-0 */}
  <div className="flex-1 min-h-0 overflow-hidden">
    {rightTab === "status"    && <div className="h-full overflow-y-auto"><StatusPanel /></div>}
    {rightTab === "activity"  && <div className="h-full flex flex-col overflow-hidden"><ActivityPanel events={activities} /></div>}
    {rightTab === "workspace" && <WorkspacePanel ... />}
    {rightTab === "projects"  && <ProjectLibraryPanel ... />}
  </div>
</aside>
```

## Tab state

```typescript
const [rightTab, setRightTab] = useState<
  "status" | "activity" | "workspace" | "projects"
>("workspace");
```

Default is `"workspace"` — the most-used panel for day-to-day interaction.

## Mount/unmount vs hide

Panels are conditionally mounted (`{rightTab === "x" && ...}`) rather than
hidden with `display: none`.  This means:

- Panel component state resets when switching away and back (directory navigation
  in WorkspacePanel, search query, selected file, etc.).
- The write proposal state in WorkspacePanel is lost on tab switch.

This is an acceptable trade-off:
- Write proposal is a deliberate multi-step flow; the user should not need to
  switch tabs mid-approval.
- Activity events accumulate in `page.tsx` (not inside ActivityPanel), so no
  events are lost when the user is on another tab.
- Conditional mount is simpler than hidden divs and avoids `h-full` measurement
  issues in hidden containers.

## Tab styling

- Active tab: `text-cyan-400 border-b-2 border-cyan-500 bg-cyan-500/5`
- Inactive tab: `text-slate-500 border-b-2 border-slate-800 hover:text-slate-300 hover:border-slate-600`
- The `border-b-2` on every tab (transparent for inactive, cyan for active)
  defines the visual bottom of the tab bar without a separate container border.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/app/page.tsx` | Added `rightTab` state; replaced stacked `<aside>` with tab bar + content area; version string updated |
| `docs/decisions/053-right-sidebar-tabs.md` | This document |
| `README.md` | Version bumped to v0.7.5, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| StatusPanel | Unchanged |
| ActivityPanel | Unchanged |
| WorkspacePanel | Unchanged |
| ProjectLibraryPanel | Unchanged |
| ChatPanel | Unchanged |
| All backend routes | Unchanged |
| Write-with-approval flow | Unchanged |
| TTS system | Unchanged |

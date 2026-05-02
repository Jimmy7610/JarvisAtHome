# Decision 079 — Agent Plan Progress Summary (v1.3.5)

**Date:** 2026-05-02
**Status:** Accepted and implemented

## Context

v1.3.4 added the Ask Jarvis prompt helper.  v1.3.5 makes the plan panel easier
to read at a glance by adding a progress summary with step-count stats and a
visual progress bar.

## Design goals

- **Derived — no new state** — all metrics are computed from `chatAgentPlan.steps`
  inside the render path.  No `useState`, no `useEffect`, no localStorage keys.
- **Always current** — because values are derived, they update instantaneously
  whenever any handler calls `setChatAgentPlan`.
- **Compact** — fits the narrow panel layout without wrapping or overflowing.
- **Visual only** — no user action is triggered by progress crossing a threshold.

## Metrics

| Metric | Derivation |
|---|---|
| `totalSteps` | `steps.length` |
| `doneCount` | `steps.filter(s => s.status === "done").length` |
| `activeCount` | `steps.filter(s => s.status === "in_progress").length` |
| `plannedCount` | `steps.filter(s => s.status === "planned").length` |
| `blockedCount` | `steps.filter(s => s.status === "blocked").length` |
| `donePercent` | `Math.round((doneCount / totalSteps) * 100)` |

## UI layout

```
Plan title
Plan summary (optional)
──────────────────────────────────────
 1/5 done · 1 active · 3 planned     40%
 ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
──────────────────────────────────────
 Planning only. Steps do not run automatically.
```

Stats row:
- `X/Y done` always shown; coloured green when `doneCount > 0`
- `N active` shown only when `activeCount > 0`; coloured amber
- `N planned` shown only when `plannedCount > 0`; muted
- `N blocked` shown only when `blockedCount > 0`; coloured red
- `donePercent%` right-aligned, muted

Progress bar:
- Track: `bg-slate-700/50`, height 1 px, full-rounded
- Fill: `bg-green-500/50`, width = `donePercent%`, 300 ms CSS transition

Header compact counter:
- The existing `X/N done` text in the header is replaced by a green `X/N`
  badge that is less verbose now that the full breakdown is in the summary.

## Placement

Between `{/* Plan title + summary */}` and `{/* Safety note */}`, using an IIFE
pattern (`{(() => { ... })()}`) consistent with the multi-file proposal banner.

## Safety contract

- Pure JSX render path — no API calls, no state mutations, no side effects.
- `donePercent` reaching 100% triggers nothing.
- Backend unchanged; database unchanged.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | Progress summary block (IIFE with stats + bar) inserted between title and safety note; header done counter refined |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.3.5"` |
| `apps/web/src/app/page.tsx` | Sidebar footer → `v1.3.5 — agent plan progress summary` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.3.5"`; Agent plan progress summary Feature Status row |
| `README.md` | Heading → v1.3.5; progress summary feature bullet |
| `docs/decisions/079-agent-plan-progress-summary.md` | This document |

## What is NOT changed

- No new backend endpoints
- No database schema changes
- All plan handlers — completely unchanged
- Plan persistence — completely unchanged
- Step notes, active indicator, Ask Jarvis helper — completely unchanged
- JarvisBrain — untouched

## Next steps

- Full agent workflow: model proposes the next action for the active step.
- Auto-complete plan when all steps are done (optional banner / confetti).

# Decision 075 — Agent Plan Per-Chat Persistence (v1.3.1)

**Date:** 2026-05-01
**Status:** Accepted and implemented

## Context

v1.3.0 added the agent plan panel but stated explicitly that plans reset on page
refresh (no persistence).  v1.3.1 promotes plans to the same durability level as
the memory context selection: they survive page refresh and are scoped per chat
session.

## Design goals

- **Per-session isolation** — switching to another chat restores that chat's plan
  (or shows nothing if no plan was saved).
- **No backend** — plans live only in the browser.  No new API routes, no
  database changes.
- **Immediate persistence** — every state-changing action (detect, mark done,
  reset, clear) writes through to localStorage in the same synchronous pass as
  the React state update.
- **Safe fallback** — corrupted or missing entries are silently ignored; the chat
  always continues normally.
- **Session cleanup** — deleting a chat session removes its plan from the map so
  the map does not accumulate stale entries indefinitely.

## Storage format

```
localStorage key: "jarvis:agent-plan-by-session"
value: JSON.stringify({ "<sessionId>": AgentPlanState, ... })
```

Same pattern as `jarvis:memory-context-by-session`.  The key is the numeric
backend session ID converted to a string.

## Restore point

`ChatPanel` remounts on every session switch via `key={activeSessionId ?? "new"}`
in `page.tsx`.  The mount `useEffect` already sets `sessionIdRef.current` from
localStorage before doing any async work.  The plan restore is placed right after
that synchronous assignment so the correct session ID is always available:

```typescript
sessionIdRef.current = existingId;
const savedPlan = readAgentPlanForSession(existingId);
if (savedPlan) setChatAgentPlan(savedPlan);
```

No separate `useEffect` watching the session ID is needed.

## Save points

| Action | When saved |
|---|---|
| Assistant-generated plan detected | Inside `detectAndSetAgentPlan()`, after `setChatAgentPlan(plan)` |
| User-pasted plan intercepted | In `send()` plan interception block, after `setChatAgentPlan(plan)` |
| Step marked done | Inside the `setChatAgentPlan` state updater in `handleMarkStepDone()` |
| Step reset to planned | Inside the `setChatAgentPlan` state updater in `handleResetStep()` |
| Plan cleared | `removeAgentPlanForSession()` called in `handleClearPlan()` before `setChatAgentPlan(null)` |

Using the state updater function for mark-done / reset guarantees the value
written to localStorage matches the value committed to React state — the updater
runs with the latest state even if stale closures are in play.

## What changed vs v1.3.0

- `send()` no longer clears `chatAgentPlan` at the top of the stale-clearing
  block.  Plans now persist across messages within a session; the user dismisses
  them explicitly with the × button.
- Plan state is saved on every mutating action instead of only living in React
  component state.

## Session cleanup

`page.tsx handleDeleteSession` now calls `clearAgentPlanForSession(id)` alongside
the existing `clearMemoryContextForSession(id)`.  A module-level helper in
`page.tsx` reads the map, deletes the entry, and writes it back.

## Safety contract (unchanged from v1.3.0)

- No new write paths.
- No autonomous actions.
- Backend unchanged.
- Chat preserved for invalid/missing plan data.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `AGENT_PLAN_BY_SESSION_KEY` constant; `readAgentPlanMap`, `writeAgentPlanMap`, `readAgentPlanForSession`, `saveAgentPlanForSession`, `removeAgentPlanForSession` helpers; mount `useEffect` restore; save calls in `detectAndSetAgentPlan`, user-pasted plan interception, `handleMarkStepDone`, `handleResetStep`; `removeAgentPlanForSession` in `handleClearPlan`; removed `setChatAgentPlan(null)` from `send()` stale-clearing |
| `apps/web/src/app/page.tsx` | `AGENT_PLAN_BY_SESSION_KEY` constant; `clearAgentPlanForSession` helper; `clearAgentPlanForSession(id)` in `handleDeleteSession`; sidebar footer → `v1.3.1 — agent plan persistence` |
| `apps/api/src/routes/settings.ts` | `appVersion` → `"1.3.1"` |
| `apps/web/src/components/SettingsPanel.tsx` | Version fallbacks → `"1.3.1"`; Feature Status — Agent plan persistence row |
| `README.md` | Heading → v1.3.1; agent plan persistence feature bullet |
| `docs/decisions/075-agent-plan-per-chat-persistence.md` | This document |

## What is NOT changed

- No new backend endpoints
- No database schema changes
- Write proposal flows — completely unchanged
- Per-file Include/Skip — completely unchanged
- Agent plan panel UI — completely unchanged
- JarvisBrain — untouched

## Next steps

- Per-step notes / comments field.
- In-progress step indicator while Jarvis is responding.
- Full agent workflow: model suggests the next action for the user to approve.

# Decision 011 — Verify SQLite Dependency

**Date:** 2026-04-27  
**Status:** Accepted — `better-sqlite3` confirmed working

## Context

Decision 010 proposed `better-sqlite3` as the SQLite driver for backend chat persistence but flagged a Windows-specific risk: the package requires native C++ compilation and may fail if Visual Studio Build Tools are not installed.

This decision records the result of the verification step.

## Verification result

| Check | Result |
|---|---|
| `npm install better-sqlite3` | ✓ Succeeded — pulled prebuilt binary, no native compilation required |
| `npm install @types/better-sqlite3` | ✓ Succeeded |
| In-memory database created | ✓ `new Database(":memory:")` |
| Table create + insert + select round-trip | ✓ `id=1, value=ok` |
| Database closed cleanly | ✓ |
| TypeScript lint (`tsc --noEmit`) | ✓ Clean — no errors |
| Node version | v24.11.1 |
| Platform | win32 |

### Native build tools

**Not required.** `better-sqlite3` shipped a prebuilt binary for Node v24 on Windows (x64) via `prebuild-install`. The install produced one deprecation warning about `prebuild-install@7.1.3` being unmaintained — this is cosmetic and does not affect functionality.

## Decision

Proceed with `better-sqlite3` for backend chat persistence. No fallback to `sql.js` is needed.

## What was changed

**`apps/api/package.json`**
- Added `better-sqlite3: ^12.9.0` to `dependencies`.
- Added `@types/better-sqlite3: ^7.6.13` to `devDependencies`.
- Added `verify:sqlite` script: `node src/dev/verify-sqlite.js`.

**`apps/api/src/dev/verify-sqlite.js`** (new)
- Minimal in-memory verification script. Kept under `src/dev/` for repeatability.
- Uses `:memory:` database only — no file written to disk.

## Next step

Implement Phase 1 of backend chat persistence:
1. Create `apps/api/src/services/db.ts` — opens `data/memory/jarvis.sqlite`, runs schema DDL on startup.
2. Create `apps/api/src/routes/sessions.ts` — `POST /sessions`, `POST /sessions/:id/messages`.
3. Mount the sessions router in `apps/api/src/index.ts`.
4. Update `ChatPanel.tsx` to write messages to the backend after each successful send (fire-and-forget, localStorage stays primary).

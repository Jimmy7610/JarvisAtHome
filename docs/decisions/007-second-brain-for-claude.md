# Decision 007 — Second Brain for Claude (JarvisBrain)

**Date:** 2026-04-27  
**Status:** Partially complete — wiki and hooks done; graphify pending WSL

## What second-brain-for-claude is

A knowledge management system that prevents Claude Code from re-exploring the
same codebase from scratch at the start of every conversation. It creates a
structured wiki (markdown files in a separate git repo) that Claude reads
first, before touching source code. It also integrates a code knowledge graph
tool called `graphify` for fast symbol lookups.

Repository: https://github.com/bright-interaction/second-brain-for-claude

## Where JarvisBrain lives

```
C:\Users\Jimmy\Documents\GitHub\JarvisBrain\
```

This is a **separate git repository** from the Jarvis app. It contains:

```
index.md             — quick-reference entry point
log.md               — append-only change log
entities/
  jarvis-app.md      — what Jarvis is, tech stack, ports
  api-service.md     — all API routes, files, env vars
  frontend.md        — UI components, layout, design rules
  ollama-service.md  — Ollama endpoints, installed models
concepts/
  model-resolution.md  — 5-step model fallback priority chain
  streaming-chat.md    — NDJSON streaming protocol, data flow
  chat-history.md      — localStorage key, load/save logic
  monorepo-structure.md — npm workspaces, root scripts
  safety-rules.md      — hard constraints Claude must never violate
maps/
  architecture.md    — full system topology diagram
  v01-status.md      — done vs planned features, all milestones
```

## Installation status

### Completed

- ✅ JarvisBrain wiki repo created at `C:\Users\Jimmy\Documents\GitHub\JarvisBrain`
- ✅ Wiki populated with real Jarvis knowledge (entities, concepts, maps)
- ✅ Claude Code hooks added to `.claude/settings.json` (3 hooks)
- ✅ `graphify-out/` added to `.gitignore`

### Not yet complete — requires WSL

- ❌ `graphify` Python tool not installed — requires macOS, Linux, or **WSL**
- ❌ Code knowledge graph not built — depends on `graphify`
- ❌ Post-commit auto-rebuild hook not active — depends on `graphify`

## Windows / WSL caveat

`graphify` is a Python tool that depends on platform-specific libraries. The
second-brain-for-claude setup script explicitly requires macOS, Linux, or WSL.
It does **not** run natively on Windows PowerShell/cmd.

To complete the graphify setup later:
1. Open WSL (Windows Subsystem for Linux).
2. Navigate to the Jarvis repo: `cd /mnt/c/Users/Jimmy/Documents/GitHub/Jarvis`
3. Clone second-brain-for-claude and follow its SETUP.md from within WSL.
4. `graphify query 'rebuild'` will create `graphify-out/graph.json` (already gitignored).

## Claude Code hooks added

File: `.claude/settings.json` (new file, does not conflict with `settings.local.json`)

| Hook | Trigger | Message |
|---|---|---|
| `UserPromptSubmit` | Every message | Consult JarvisBrain index before reading source |
| `PreToolUse (Glob\|Grep)` | Before file searches | Check wiki before grepping source |
| `PostToolUse (Bash git commit*)` | After commits | Update log.md and affected wiki pages |

## How future Claude sessions should use JarvisBrain

At the start of a new session on the Jarvis project:

1. Read `C:\Users\Jimmy\Documents\GitHub\JarvisBrain\index.md` first.
2. Follow links to the relevant entity/concept/map pages for the task at hand.
3. Only read source files when the wiki does not have enough detail.
4. After making significant changes, update `log.md` and any affected wiki pages.

## Files changed in the Jarvis repo

| File | Change |
|---|---|
| `.claude/settings.json` | Created — Claude Code hooks for wiki reminders |
| `.gitignore` | Added `graphify-out/` entry with explanation |
| `docs/decisions/007-second-brain-for-claude.md` | This file |

## Files NOT changed

- `CLAUDE.md` — unchanged (wiki supplements it, does not replace it)
- `.claude/settings.local.json` — unchanged (permissions only)
- All Jarvis app code — unchanged

## What should be gitignored

- `graphify-out/` — already added; large, machine-specific, auto-rebuilt
- `.claude/*.local.json` — already in `.gitignore`
- The `JarvisBrain` repo itself is a **separate repo** — not a subfolder of Jarvis

# Decision 047 - Piper Quick Launcher (v0.5.10)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

Once Piper is installed, the local TTS dev workflow requires two terminal windows:

1. Start the Piper TTS wrapper:
   ```powershell
   $env:PIPER_BIN="...\local-tts\piper\piper\piper.exe"
   $env:PIPER_VOICE_MODEL="...\local-tts\voices\en_GB-alan-medium.onnx"
   $env:PIPER_VOICE_CONFIG="...\local-tts\voices\en_GB-alan-medium.onnx.json"
   npm run dev:tts-piper
   ```

2. Start the Jarvis dev stack in a second window:
   ```powershell
   npm run dev
   ```

This is repetitive and error-prone (typos in env var paths, forgetting to start
one of the two processes).  A launcher script reduces daily friction to one command.

## Why this script exists

- Eliminates the need to manually set three env vars and start two processes.
- Checks prerequisites before launching (missing Piper files exit early with help).
- Detects port 5005 conflicts and handles them gracefully instead of crashing.
- Warns when `apps/api/.env` is missing or misconfigured.
- Gives a single-command daily workflow for local TTS development.

## Why it is local/dev-only

- The script references `local-tts\piper\piper\piper.exe` — a gitignored file
  that only exists after running the setup helper.
- It opens developer-facing PowerShell windows rather than running as a service.
- It is not intended for production — production Jarvis uses browser TTS only,
  and no local TTS server runs in production.
- The script is committed to the repo but the files it needs are gitignored.

## Why it does not install or download anything

- The Jarvis safety principle: no automatic downloads or installs without
  explicit user action.
- Piper was already downloaded by `scripts/setup-piper-windows.ps1`.
- The launcher's only job is to orchestrate processes that are already in place.

## Why it opens separate windows instead of hiding processes

- Background processes are hard to stop and impossible to see.
- Separate visible windows let Jimmy:
  - See Piper log output (each /speak request is logged).
  - See the Jarvis dev server output (API requests, errors, hot-reload).
  - Stop each process independently with Ctrl+C or by closing the window.
- This is a dev tool — visibility is more valuable than tidiness.

## What the script checks

1. **Piper file existence:**
   - `local-tts\piper\piper\piper.exe`
   - `local-tts\voices\en_GB-alan-medium.onnx`
   - `local-tts\voices\en_GB-alan-medium.onnx.json`
   - If any are missing: exits with code 1 and points to `setup-piper-windows.ps1`.

2. **Port 5005:**
   - Uses `Get-NetTCPConnection -LocalPort 5005 -State Listen`.
   - If already in use: skips the Piper window, continues to start Jarvis.
   - This handles the case where a Piper wrapper is already running.

3. **apps/api/.env:**
   - Warns if the file is missing entirely.
   - Warns if `LOCAL_TTS_ENABLED=true` is not present.
   - Does not exit — just informs (the API will start but Local TTS will be disabled).

## Optional parameters

| Parameter | Effect |
|---|---|
| `-SkipPiper` | Skip the Piper wrapper window |
| `-SkipJarvis` | Skip the Jarvis dev window |
| Both together | Run all checks and print summary, open no windows |

These are useful for testing the prerequisite checks without actually starting anything.

## What remains manual

1. Running `scripts/setup-piper-windows.ps1` first (one time, installs Piper).
2. Creating `apps/api/.env` with the correct TTS settings (one time).
3. Switching from Browser voice to Local TTS in the Jarvis UI (first use).
4. Closing the two PowerShell windows when done.
5. Re-running the launcher each dev session.

## Files changed

| File | Change |
|---|---|
| `scripts/start-jarvis-with-piper.ps1` | New - quick launcher |
| `docs/setup/local-tts-server.md` | Section L added (launcher docs) |
| `docs/setup/piper-windows-checklist.md` | Section L added (daily start) + Quick reference updated |
| `docs/architecture/local-tts-roadmap.md` | Step 8 added (v0.5.10), status updated |
| `docs/decisions/047-piper-quick-launcher.md` | This document |
| `README.md` | Version bumped to v0.5.10, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| Browser TTS | Unchanged |
| Mock TTS server | Unchanged |
| Piper HTTP wrapper | Unchanged |
| POST /tts/speak API route | Unchanged |
| Frontend speakWithLocalTts | Unchanged |
| npm run dev / dev:tts-piper scripts | Unchanged |
| .gitignore | Unchanged (local-tts/ already gitignored) |

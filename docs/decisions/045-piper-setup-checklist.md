# Decision 045 - Piper Setup Checklist (v0.5.8)

**Date:** 2026-04-28
**Status:** Accepted and implemented

## Context

v0.5.7 added `scripts/setup-piper-windows.ps1` — a PowerShell helper that
downloads Piper and a voice model into `local-tts/` (gitignored).  The script
requires three URL variables to be filled in before it does anything.

However, there was no single document explaining:

- Which release page to check for the Piper binary URL.
- Which voice files are available and how to choose one.
- How to navigate HuggingFace to get the direct download URLs.
- What to do after the script runs (start wrapper, configure API, test).

The setup script's placeholder error message was also minimal — it told the
user to fill in the variables but did not explain where to look.

## Why the checklist was added

A dedicated checklist (`docs/setup/piper-windows-checklist.md`) gives Jimmy a
single document to read before touching the setup script.  It:

1. States the safety rules upfront (what not to commit, no voice cloning).
2. Lists exact official URLs to check (GitHub releases, HuggingFace).
3. Explains how to navigate to download links for both the binary and voice models.
4. Gives voice selection guidance (calm/clear English, no fictional character aim).
5. Shows the exact script variables to fill and what pattern each URL follows.
6. Provides copy-paste commands for starting the wrapper, setting API env vars,
   and testing with curl/PowerShell/the Jarvis UI.
7. Covers cleanup and how to switch back to browser TTS.

This removes the need to guess or consult separate documentation pages.

## Why URLs are not hardcoded

Piper is under active development.  The GitHub release URL includes a version
tag (e.g. `2023.11.14-2`) that changes with each new release.  Hardcoding a
specific tag means the script would download an outdated binary silently.

HuggingFace voice model paths are stable by voice name, but voice availability
and recommended choices may change over time.

Placeholders force Jimmy to look at the current official release page before
running the script — this is the correct behaviour.  It ensures:

- The latest stable binary is always downloaded (not a pinned old version).
- Jimmy has read the release notes and confirmed the download is from the right source.
- No fake or guessed URLs are ever committed to the repo.

## Why no download is performed automatically

The Jarvis development principles require explicit user actions for any operation
that fetches data from the internet.  Automatic downloads would:

- Run without Jimmy's knowledge if the script were ever called by another tool.
- Potentially download large files (20+ MB binary, 50-100 MB model) without consent.
- Bypass the "read what you are running" safety check.

The setup script requires Jimmy to both fill in the URLs AND run the script manually.
Two explicit opt-in steps are intentional.

## What remains manual

1. Visiting https://github.com/rhasspy/piper/releases to get the current zip URL.
2. Visiting https://huggingface.co/rhasspy/piper-voices to pick a voice and get URLs.
3. Filling `$PiperZipUrl`, `$VoiceModelUrl`, `$VoiceConfigUrl` in the script.
4. Running the script: `powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1`
5. Setting `$env:PIPER_BIN` / `$env:PIPER_VOICE_MODEL` before each terminal session.
6. Creating/updating `apps/api/.env` with `LOCAL_TTS_ENABLED=true`.
7. Choosing a voice — the script downloads one; trying others requires manual steps.

## Files changed

| File | Change |
|---|---|
| `docs/setup/piper-windows-checklist.md` | New - complete Piper setup checklist |
| `scripts/setup-piper-windows.ps1` | Placeholder error output now references checklist; version bumped to v0.5.8 |
| `docs/setup/local-tts-server.md` | Section J added - link to checklist |
| `docs/architecture/local-tts-roadmap.md` | Step 6 added (v0.5.8), status updated |
| `docs/decisions/045-piper-setup-checklist.md` | This document |
| `README.md` | Version bumped to v0.5.8, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| Browser TTS (`speakWithBrowserTts`) | Unchanged |
| Mock server (`scripts/local-tts-mock-server.mjs`) | Unchanged |
| Piper wrapper (`scripts/local-tts-piper-server.mjs`) | Unchanged |
| `POST /tts/speak` API route | Unchanged |
| Frontend (`speakWithLocalTts`) | Unchanged |
| Piper binary or voice models | Not installed or bundled |
| External or cloud TTS | Not added |
| `.gitignore` | Already covers all required patterns from v0.5.6 |

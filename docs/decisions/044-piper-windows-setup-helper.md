# Decision 044 — Piper Windows Setup Helper (v0.5.7)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.5.6 added `scripts/local-tts-piper-server.mjs`, the HTTP wrapper that bridges
Jarvis and the Piper binary.  To use it, Jimmy needs to:

1. Download the Piper Windows release zip from GitHub.
2. Extract it.
3. Download a voice model (`.onnx`) and its config (`.onnx.json`) from Hugging Face.
4. Set `PIPER_BIN` and `PIPER_VOICE_MODEL` environment variables.
5. Run `npm run dev:tts-piper`.

That is five manual steps with file locations that must be consistent between
the download, the extraction, and the env vars.  A helper script removes the
friction and ensures the directory layout matches what the wrapper expects.

## Why a helper script

- Reduces the chance of path typos between the downloaded binary location and
  the env vars the wrapper reads.
- Creates the gitignored `local-tts/` directory structure automatically.
- Skips files that are already present — idempotent, safe to re-run.
- Prints exact copy-paste commands at the end — no mental mapping required.

## Why it does not run automatically

The script downloads files from the internet (GitHub, Hugging Face).  Automatic
downloads violate the Jarvis principle of explicit, user-approved actions.
The user must opt in by running the script manually:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1
```

## Why binaries and models stay out of Git

- Piper binaries are ~20 MB.  ONNX voice models are 50–100 MB each.
- Git is not designed for large binary blobs — they bloat the repository
  forever (even after deletion from the working tree, history is retained).
- Binaries are platform-specific (Windows x64 vs Linux arm64 vs macOS).
  Committing one platform's binary breaks nothing for others but adds unnecessary
  weight for everyone.
- License terms for voice model weights should be verified separately; committing
  them to a repo may have different implications than personal use.
- `.gitignore` already covers `local-tts/`, `*.onnx`, `*.onnx.json`, `*.wav`, `*.mp3`.

## Why official URLs must be explicit

Piper is under active development.  New releases change the download URL's
version tag.  Hardcoding a specific version tag means the script would silently
download an outdated binary when a newer one exists.

Instead, the script uses placeholder variables:

```powershell
$PiperZipUrl    = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_RELEASE>"
$VoiceModelUrl  = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_VOICE>"
$VoiceConfigUrl = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_VOICE_CONFIG>"
```

The script validates these at startup and exits with a clear message if any
placeholder is still present.  This forces Jimmy to look at the current official
release page and choose the version he wants — which is the correct behaviour.

## What remains manual

1. Filling in the three URL variables in `setup-piper-windows.ps1` — intentional.
2. Setting `$env:PIPER_BIN` / `$env:PIPER_VOICE_MODEL` in each new terminal session
   (PowerShell `$env:` assignments are session-scoped).
3. Updating `apps/api/.env` with `LOCAL_TTS_ENABLED=true` etc.
4. Choosing a voice — the script downloads one default English voice; other
   voices (e.g. Swedish `sv_SE-nst-medium`) must be downloaded manually.

## Files changed

| File | Change |
|---|---|
| `scripts/setup-piper-windows.ps1` | New — optional Piper download/setup helper |
| `docs/setup/local-tts-piper-env-example.ps1` | New — reference env var example |
| `docs/setup/local-tts-server.md` | Section I added (v0.5.7 helper) |
| `docs/architecture/local-tts-roadmap.md` | Step 5 added (v0.5.7), status updated |
| `docs/decisions/044-piper-windows-setup-helper.md` | This document |
| `README.md` | Version bumped to v0.5.7, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| Browser TTS (`speakWithBrowserTts`) | Unchanged |
| Mock server (`scripts/local-tts-mock-server.mjs`) | Unchanged |
| Piper wrapper (`scripts/local-tts-piper-server.mjs`) | Unchanged |
| `POST /tts/speak` API route | Unchanged |
| Frontend (`speakWithLocalTts`) | Unchanged |
| Piper / Kokoro binaries | Not installed or bundled |
| External / cloud TTS | Not added |
| `.gitignore` | Already covered `local-tts/`, `*.onnx`, `*.onnx.json`, `*.wav`, `*.mp3` |

# Decision 046 - Piper Official URL Selection (v0.5.9)

**Date:** 2026-04-29
**Status:** Accepted and implemented

## Context

v0.5.7 and v0.5.8 added `scripts/setup-piper-windows.ps1` and a setup checklist,
but the three URL variables in the script remained as placeholders.  Jimmy could
not run the setup without first finding and filling in the official URLs manually.

v0.5.9 resolves that by researching and verifying the official URLs and pre-filling
them into the script so the setup is ready to run with a single command.

## Official sources used

| Source | URL |
|---|---|
| Piper releases page | https://github.com/rhasspy/piper/releases |
| Piper GitHub API | https://api.github.com/repos/rhasspy/piper/releases/tags/2023.11.14-2 |
| HuggingFace piper-voices | https://huggingface.co/rhasspy/piper-voices |

All three final URLs were verified with HTTP HEAD requests that returned HTTP 200
on 2026-04-29.  No file was downloaded during this research.

## Selected Piper release

| Property | Value |
|---|---|
| Release tag | `2023.11.14-2` |
| Asset | `piper_windows_amd64.zip` |
| Download URL | `https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip` |
| File size | approx 21 MB |
| Verified | HTTP 200 HEAD, 2026-04-29 |
| Notes | This is the latest and final release. The repo was archived in October 2025 — no newer releases exist. The binary is still fully functional. |

## Selected voice model

| Property | Value |
|---|---|
| Voice ID | `en_GB-alan-medium` |
| Language | British English (en_GB) |
| Gender | Male |
| Quality | Medium |
| Model URL | `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx` |
| Config URL | `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json` |
| Model size | approx 60 MB |
| Config size | approx 5 KB |
| Verified | HTTP 200 HEAD for both files, 2026-04-29 |

## Why this voice was selected

- **British English:** preference stated in task requirements; sounds natural for an assistant.
- **Male voice:** en_GB-alan is a male voice; matches a natural assistant tone.
- **Medium quality:** balances file size (~60 MB) and audio quality well.  Low quality sounds robotic; high quality models are larger without proportional gain for most use cases.
- **Clear and calm:** the "alan" voice produces clear, neutral speech well suited to reading chat responses.
- **No fictional imitation:** this voice is not intended to imitate any real person or the movie Jarvis character.  It is a general-purpose British English TTS voice.

## Why no files were downloaded or committed

- The task explicitly stated: do not download Piper automatically during this task.
- Verifying URLs required only HTTP HEAD requests — no data is transferred beyond headers.
- Binaries and models are always gitignored (`local-tts/`, `*.onnx`, `*.wav`, etc.).
- Jimmy must run the setup script manually when he is ready to commit the ~80 MB download.

## What the -DryRun parameter does

A `-DryRun` switch was added to `scripts/setup-piper-windows.ps1`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1 -DryRun
```

DryRun:
- Validates that URLs are not placeholders.
- Prints all three URLs with their destination paths and approximate sizes.
- Does NOT download any files.
- Does NOT create `local-tts/` directories.
- Exits with code 0 on success.

This lets Jimmy review exactly what will be downloaded before committing to it.

## What remains manual

1. Running the setup script: `powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1`
2. Setting `$env:PIPER_BIN` / `$env:PIPER_VOICE_MODEL` in each new terminal session.
3. Creating/updating `apps/api/.env` with `LOCAL_TTS_ENABLED=true` etc.
4. Running `npm run dev:tts-piper` to start the wrapper.
5. Testing with the Jarvis UI (TTS: Local TTS > Test voice).
6. If the voice quality is unsatisfactory, choosing a different voice and re-running the setup.

## Files changed

| File | Change |
|---|---|
| `scripts/setup-piper-windows.ps1` | URLs filled in; comments added with source/date; `-DryRun` parameter added; version bumped to v0.5.9 |
| `docs/setup/piper-windows-checklist.md` | v0.5.9 note added; confirmed URL table added to section F; `-DryRun` usage added to section G |
| `docs/setup/local-tts-server.md` | Section K added with confirmed URLs and DryRun note |
| `docs/architecture/local-tts-roadmap.md` | Step 7 added (v0.5.9 URL selection), status updated |
| `docs/decisions/046-piper-official-url-selection.md` | This document |
| `README.md` | Version bumped to v0.5.9, feature bullet added |

## What is NOT changed

| Property | Status |
|---|---|
| Browser TTS | Unchanged |
| Mock TTS server | Unchanged |
| Piper HTTP wrapper | Unchanged |
| POST /tts/speak API route | Unchanged |
| Frontend speakWithLocalTts | Unchanged |
| Piper binary | Not installed |
| Voice model files | Not downloaded |
| .gitignore | Already covers all patterns from v0.5.6 |

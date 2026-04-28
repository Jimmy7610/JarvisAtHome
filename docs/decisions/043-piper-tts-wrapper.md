# Decision 043 — Piper TTS HTTP Wrapper Foundation (v0.5.6)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.5.5 added a mock TTS server and setup documentation, but the full audio path
could only be tested with a synthetic 440 Hz beep.  No real speech synthesis was
available.  The roadmap called for a "thin HTTP wrapper" around the Piper binary
as the recommended first real TTS engine.

## Design

### Wrapper script (`scripts/local-tts-piper-server.mjs`)

**Technology:** Node.js built-in modules only (`http`, `child_process`, `fs/promises`,
`path`, `os`, `crypto`).  Zero new npm dependencies.

**What it does:**

- Reads `PIPER_BIN` and `PIPER_VOICE_MODEL` from environment variables.
- Listens on `http://127.0.0.1:${PIPER_SERVER_PORT}` (default: 5005).
- `GET /` → JSON status page with `configured`, `piperBin`, `voiceModel`, `ready`.
- `POST /speak` → synthesises speech via Piper and returns `audio/wav`.

**`runPiper(text)` strategy:**

1. Generate a unique temp file path in `os.tmpdir()`.
2. Spawn the Piper binary with `--model <PIPER_VOICE_MODEL>` and `--output_file <tmp.wav>`.
3. Write `normaliseText(text) + "\n"` to Piper's stdin and close it.
4. Hard timeout (30 s) via `setTimeout` + `SIGKILL`.
5. On exit code 0: `readFile(tmpWav)`, return Buffer, then `unlink` temp file.
6. On non-zero exit or timeout: reject with a diagnostic message, delete temp file.

**Why `--output_file` instead of `--output-raw`:**

`--output-raw` writes headerless PCM.  Wrapping it in a valid RIFF/WAV header
requires knowing the voice model's sample rate.  `--output_file` produces a
correct WAV file regardless of sample rate or Piper version — more portable
across Windows/Linux/macOS and future Piper releases.

**`normaliseText(text)`:**

Collapses all `\r\n` and `\n` to single spaces so Piper receives one utterance
rather than many lines (Piper treats newlines as utterance boundaries and
synthesises each separately, which can produce unexpected behaviour).

**Text length limit:** 4000 characters (same as the API route).

**Timeout:** 30 seconds with `SIGKILL` — covers slow first-run model loading.

**Logging:** Incoming text is truncated to 80 chars before logging — never logs
full request bodies.

### Error states and responses

| Condition | HTTP code | Body |
|---|---|---|
| `PIPER_BIN` or `PIPER_VOICE_MODEL` not set | 503 | `{ ok: false, error: "..." }` |
| Empty or missing `text` field | 400 | `{ ok: false, error: "..." }` |
| `text` exceeds 4000 characters | 400 | `{ ok: false, error: "..." }` |
| Failed to start binary (`ENOENT` etc.) | 500 | `{ ok: false, error: "..." }` |
| Piper non-zero exit | 500 | `{ ok: false, error: "... stderr: ..." }` |
| Piper timeout | 500 | `{ ok: false, error: "timed out..." }` |
| WAV file not created despite exit 0 | 500 | `{ ok: false, error: "..." }` |
| Success | 200 | `audio/wav` bytes |

### npm script

```json
"dev:tts-piper": "node scripts/local-tts-piper-server.mjs"
```

### `.gitignore` additions

```
local-tts/
*.onnx
*.onnx.json
*.wav
*.mp3
```

`local-tts/` is the recommended directory for the Piper binary and voice models
(`local-tts/piper/piper.exe`, `local-tts/voices/*.onnx`).

### Setup guide update (`docs/setup/local-tts-server.md`)

Added section H: Windows-focused step-by-step Piper setup covering binary
download, model download, env var configuration, and test commands.

## What is NOT changed

| Property | Status |
|---|---|
| Browser TTS (`speakWithBrowserTts`) | Unchanged |
| Mock server (`scripts/local-tts-mock-server.mjs`) | Unchanged |
| `POST /tts/speak` API route | Unchanged |
| Frontend (`speakWithLocalTts`) | Unchanged |
| Piper / Kokoro binaries | Not installed or bundled |
| External / cloud TTS | Not added |

## Files changed

| File | Change |
|---|---|
| `scripts/local-tts-piper-server.mjs` | New — Piper HTTP wrapper |
| `package.json` | `dev:tts-piper` script added |
| `.gitignore` | `local-tts/`, `*.onnx`, `*.onnx.json`, `*.wav`, `*.mp3` added |
| `docs/setup/local-tts-server.md` | Section H added (Piper Windows setup) |
| `docs/architecture/local-tts-roadmap.md` | Updated to reflect v0.5.6 status |
| `docs/decisions/043-piper-tts-wrapper.md` | This document |
| `README.md` | Version bumped to v0.5.6, feature bullet added |

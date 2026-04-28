# Decision 042 — Local TTS Server Setup Guide and Mock Server (v0.5.5)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.5.4 wired `speakWithLocalTts` to call `POST /tts/speak` on the Jarvis API,
which in turn proxies to a configured local TTS server.  However:

- No local TTS server (Piper/Kokoro) was installed.
- The "Local TTS" provider path could not be tested end-to-end.
- There was no documentation on how to set one up.

v0.5.5 bridges that gap with:

1. A comprehensive setup guide for real local TTS servers.
2. A tiny development mock server that returns a WAV beep so the full audio
   path can be verified without installing any real TTS engine.

## Design

### Mock server (`scripts/local-tts-mock-server.mjs`)

**Technology:** Node.js built-in `http` module only — zero new npm dependencies.

**What it does:**

- Listens on `http://127.0.0.1:5005` (localhost-only bind address).
- `GET /` → plain-text status page (useful for a quick browser sanity check).
- `POST /speak` → accepts JSON `{ text, lang, voice }`, logs the incoming text,
  returns a 440 Hz sine-wave beep as `audio/wav`.

**WAV generation:**

A 44-byte RIFF/PCM header + 16-bit mono PCM samples at 22 050 Hz, generated
in-process from a sine formula.  A 10 % linear fade-in and fade-out prevents
audible clicks at the start and end of the beep.  The WAV is generated once at
startup and re-used for every request.

**Purpose:**

The mock does not synthesise real speech.  It exercises the full transport path:

```
ChatPanel → /tts/speak → mock server → WAV bytes → HTMLAudioElement
```

This confirms that:
- The API route correctly forwards and returns audio bytes.
- `Content-Type: audio/wav` is accepted by the frontend.
- `HTMLAudioElement` plays the audio.
- `speaking` state is set and cleared.
- `stopVoice()` pauses the audio element.
- Object URL is created and revoked cleanly.

**How to run:**

```bash
npm run dev:tts-mock
```

### `dev:tts-mock` script in root `package.json`

```json
"dev:tts-mock": "node scripts/local-tts-mock-server.mjs"
```

No new dependencies; runs with the Node.js version already required (≥ 20).

### Setup guide (`docs/setup/local-tts-server.md`)

Covers:
- Architecture diagram (ChatPanel → API → local server → audio → HTMLAudioElement)
- Safety rules (localhost-only, no cloud, no API keys, no model files in repo)
- Recommended engines (Piper first, Kokoro future)
- Environment configuration (`LOCAL_TTS_ENABLED`, `LOCAL_TTS_BASE_URL`, `LOCAL_TTS_PROVIDER`)
- Expected POST /speak contract
- Manual test steps (real server and mock server)
- Cleanup instructions
- Piper quick-start sketch

### No code changes to API or frontend

The existing `POST /tts/speak` route (`apps/api/src/routes/tts.ts`) and the
frontend `speakWithLocalTts` function already implement the full path correctly.
No modifications needed.

## What is NOT changed

| Property | Status |
|---|---|
| `POST /tts/speak` route | Unchanged |
| Browser TTS (`speakWithBrowserTts`) | Unchanged |
| Mic recognition | Unchanged |
| Write-with-approval flow | Unchanged |
| Proposal JSON not spoken | Unchanged |
| JarvisBrain repository | Untouched |
| Piper / Kokoro binaries | Not installed |
| External / cloud TTS | Not added |

## Files changed

| File | Change |
|---|---|
| `scripts/local-tts-mock-server.mjs` | New — development mock server |
| `package.json` | `dev:tts-mock` script added |
| `docs/setup/local-tts-server.md` | New — comprehensive setup guide |
| `docs/architecture/local-tts-roadmap.md` | Updated to reflect v0.5.5 additions |
| `docs/decisions/042-local-tts-server-setup.md` | This document |
| `README.md` | Version bumped to v0.5.5, feature bullet added |

# Decision 041 — Local TTS HTTP Provider Foundation (v0.5.4)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.5.3 added the `TtsProvider` type (`"browser" | "local"`) and a provider dropdown
in the voice bar, but `speakWithLocalTts` was only a placeholder that showed a
static error message.

v0.5.4 activates the Local TTS path as a real (but disabled-by-default) HTTP
proxy through the Jarvis API.  No Piper/Kokoro binaries are installed — the route
simply forwards to whatever local TTS server is configured.

## Design

### Backend — `POST /tts/speak`

Located in `apps/api/src/routes/tts.ts`, mounted at `/tts`.

**Request body:**

```json
{ "text": "Hello Jimmy.", "lang": "sv-SE", "voice": "optional-voice-name" }
```

**Behavior when `LOCAL_TTS_ENABLED` is `false` (default):**

```json
{ "ok": false, "error": "Local TTS is not enabled. Set LOCAL_TTS_ENABLED=true in apps/api/.env to activate it." }
```

**Behavior when enabled — forwards to `${LOCAL_TTS_BASE_URL}/speak`:**

- If the upstream returns `audio/*` bytes → piped straight to the frontend with the same `Content-Type`.
- If the upstream returns a non-audio response → JSON error extracted and returned.
- If the upstream is unreachable → friendly JSON error.
- If the upstream takes > 20 s → `AbortController` fires, friendly timeout error returned.

**Validation:**

| Field | Rule |
|---|---|
| `text` | Non-empty string, ≤ 4000 characters |
| `lang` | Optional string, clamped to 20 chars |
| `voice` | Optional string, clamped to 200 chars |

### Security: localhost-only enforcement

`ensureLocalhost()` in `config.ts` validates `LOCAL_TTS_BASE_URL` at startup.
Any URL whose hostname is not `localhost`, `127.0.0.1`, or `::1` is rejected and
the default `http://localhost:5005` is used instead.

The frontend **never** supplies the upstream URL — it only sends `text/lang/voice`.
This means the route cannot be abused as an open proxy by a page-level attacker.

### Backend config additions (`apps/api/src/config.ts`)

```typescript
localTts: {
  enabled: process.env.LOCAL_TTS_ENABLED === "true",   // default: false
  baseUrl: ensureLocalhost(process.env.LOCAL_TTS_BASE_URL ?? "http://localhost:5005", ...),
  provider: process.env.LOCAL_TTS_PROVIDER || "generic",
}
```

### Frontend — `speakWithLocalTts(text)`

Replaces the v0.5.3 placeholder.  The function is `async` and fire-and-forgotten
via `void speakWithLocalTts(text)` at all call sites.

Flow:
1. `stopLocalAudio()` — stop any currently playing local audio.
2. `fetch(API_URL + "/tts/speak", { method: "POST", body: { text, lang, voice } })`.
3. If response `content-type` starts with `audio/`: create an object URL, play via `new Audio(objectUrl)`, wire `onplay/onended/onerror` to `setSpeaking`.
4. Otherwise: parse JSON, set `setSpeechError(data.error)`.
5. On network error: set `setSpeechError("Could not reach Jarvis API for local TTS…")`.

### New refs

| Ref | Purpose |
|---|---|
| `audioRef` | Active `HTMLAudioElement` for local TTS; stopped by `stopVoice()` and on unmount |
| `objectUrlRef` | Current object URL; revoked on playback end / stop / unmount to prevent memory leaks |

### `stopLocalAudio()` helper

Shared by `stopVoice()`, the `speakReplies`-off effect, the unmount cleanup, and
`speakWithLocalTts` itself (clears previous audio before starting a new one).

### `stopVoice()` updated

Now calls `stopLocalAudio()` in addition to cancelling browser `speechSynthesis`.

### `speakPreview()` updated

When `ttsProvider === "local"`, the preview phrase is forwarded to
`speakWithLocalTts(phrase)` instead of showing a static error.  If Local TTS is
not enabled, the API error message appears in the speech error row — same UX as
a failed voice reply.

### Voice bar Row 0

The static `"not yet active"` hint from v0.5.3 is removed.  The API error message
in Row 3 (speech error) communicates the enabled state after the first attempt.

## Environment variables

Added to `apps/api/.env.example`:

```
# LOCAL_TTS_ENABLED=false
# LOCAL_TTS_BASE_URL=http://localhost:5005
# LOCAL_TTS_PROVIDER=generic
```

None of these are required.  The defaults are safe (disabled, localhost).

## Expected local TTS server contract

Any HTTP server that accepts:

```
POST /speak
Content-Type: application/json

{ "text": "...", "lang": "sv-SE", "voice": "optional" }
```

and responds with `audio/wav` or `audio/mpeg` bytes will work.

Tested candidates: Piper (with HTTP wrapper), Kokoro.

## What is NOT changed

| Property | Status |
|---|---|
| Browser TTS (`speakWithBrowserTts`) | Identical — extracted in v0.5.3, untouched here |
| Mic recognition | Unchanged |
| Language/voice persistence | Unchanged |
| Write-with-approval flow | Unchanged |
| Proposal JSON not spoken | Unchanged — safe summary sent to both providers |
| JarvisBrain repository | Untouched |
| External / cloud TTS | Not added |
| Piper / Kokoro binaries | Not installed |

## Files changed

| File | Change |
|---|---|
| `apps/api/src/config.ts` | `ensureLocalhost()` guard; `localTts` config block |
| `apps/api/src/routes/tts.ts` | New — `POST /tts/speak` route |
| `apps/api/src/index.ts` | Register `ttsRouter` at `/tts` |
| `apps/api/.env.example` | TTS env var comments added |
| `apps/web/src/components/ChatPanel.tsx` | `audioRef`, `objectUrlRef`; `stopLocalAudio()`; real `speakWithLocalTts()`; `speakAssistantText` router updated; `stopVoice()` updated; `speakPreview()` updated; unmount and speakReplies-off effects updated; Row 0 hint removed |
| `docs/architecture/local-tts-roadmap.md` | Updated to reflect route exists |
| `docs/decisions/041-local-tts-http-provider.md` | This document |
| `README.md` | Version bumped to v0.5.4, feature bullet added |

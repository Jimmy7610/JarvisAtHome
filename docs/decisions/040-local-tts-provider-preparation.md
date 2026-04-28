# Decision 040 — Local TTS Provider Preparation (v0.5.3)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.5.2 added a browser voice selector that lets the user pick among all OS/browser
SpeechSynthesis voices.  The next natural step is to support a local TTS server
(e.g. Piper, Kokoro) so that:

- Voice quality is deterministic and not dependent on which voices the OS happens
  to ship.
- A consistent Swedish voice is available regardless of browser.
- No cloud TTS is ever used.

v0.5.3 lays the architectural groundwork without connecting to any real local TTS
server.  The user-facing addition is a TTS provider dropdown in the voice bar.

## Design

### `TtsProvider` type

```typescript
type TtsProvider = "browser" | "local";
```

`"browser"` — existing Web SpeechSynthesis path (default, always available).  
`"local"` — placeholder for a future local TTS server (Piper / Kokoro).

### Provider selection

A `<select>` dropdown ("TTS:") appears as Row 0 in the voice bar (above the
language and voice rows) when `ttsSupported` is true.  The selected value
persists to localStorage under key `jarvis.voice.provider.v1` using the same
write-in-onChange pattern used for language and voice name (never in a
`useEffect` that fires on mount).

When `"local"` is selected a small `"not yet active"` note appears next to the
dropdown so the user knows it is a planned feature, not a functional one.

### `ttsProviderRef`

Mirrors `ttsProvider` via a `useEffect` — same pattern as `speakRepliesRef`,
`speechLangRef`, `selectedVoiceNameRef`.  Lets the `setTimeout` inside
`speakWithBrowserTts` read the current provider without a stale closure.

### `speakAssistantText` is now a router

The monolithic `speakAssistantText` function is split into:

| Function | Purpose |
|---|---|
| `speakWithBrowserTts(text)` | All existing browser SpeechSynthesis logic (Chrome workarounds, voice lookup, lang) |
| `speakWithLocalTts()` | Placeholder — sets a "not yet active" speechError message |
| `speakAssistantText(text)` | Reads `ttsProviderRef.current` and dispatches to the correct implementation |

All existing callers in `send()` continue to call `speakAssistantText` — they
are unaware of the provider split.

### `speakPreview` — local TTS guard

`speakPreview` (the "Test voice" button) checks `ttsProvider` state at click time.
If the selected provider is `"local"`, an informational error message is shown
instead of attempting browser speech.  The browser voice selector row is still
visible so the user can still audition browser voices after switching back.

### Support detection + provider restore

The support detection `useEffect` (runs once after mount, `[]` deps) now also
reads and validates `VOICE_PROVIDER_KEY` from localStorage and sets both the
`ttsProvider` state and `ttsProviderRef.current` before the first render paint.

## What is NOT changed

| Property | Status |
|---|---|
| Browser TTS logic | Extracted to `speakWithBrowserTts` — identical behaviour |
| Chrome bug workarounds | Unchanged inside `speakWithBrowserTts` |
| Language selection and persistence | Unchanged |
| Voice name selection and persistence | Unchanged |
| Repeat TTS fix (resume/timer) | Unchanged |
| Proposal JSON not spoken | Unchanged |
| Mic recognition | Unchanged |
| Write-with-approval flow | Unchanged |
| Backend / API routes | Unchanged |
| External APIs | Not added |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `TtsProvider` type + constants; `ttsProvider` state + `ttsProviderRef`; provider restore in support-detection effect; `ttsProviderRef` sync effect; `speakWithBrowserTts` (extracted); `speakWithLocalTts` (placeholder); `speakAssistantText` rewritten as router; `speakPreview` local-TTS guard; Row 0 (TTS provider dropdown) in voice bar JSX |
| `docs/architecture/local-tts-roadmap.md` | New — architecture plan for future Piper/Kokoro integration |
| `docs/decisions/040-local-tts-provider-preparation.md` | This document |
| `README.md` | Short note added |

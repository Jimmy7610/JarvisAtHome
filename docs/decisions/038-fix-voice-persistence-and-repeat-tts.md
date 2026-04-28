# Decision 038 — Fix Voice Language Persistence and Repeat TTS (v0.5.2)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

Two regressions were found in v0.5.1:

1. **Language persistence failed** — selecting English and pressing F5 always
   reverted to Swedish (sv-SE).

2. **TTS stopped after first response** — Jarvis spoke the first assistant response
   correctly but was silent for all subsequent responses while "Voice replies: on".

## Root cause analysis

### Bug 1 — Language persistence

The `[speechLang]` persistence useEffect wrote `speechLang` to localStorage on
every change — including on the very first mount when the state was still set to
the default value `"sv-SE"`:

```typescript
// Runs on mount because speechLang is initialized to VOICE_LANG_DEFAULT
useEffect(() => {
  speechLangRef.current = speechLang;
  localStorage.setItem(VOICE_LANG_KEY, speechLang);  // ← writes "sv-SE" on mount
}, [speechLang]);
```

React fires effects in the order they are registered.  The `[speechLang]` effect
ran **before** the `[]` load effect that reads the saved value, so every page
load began by overwriting the stored preference with the default.

### Bug 2 — TTS stops after first response (Chrome crbug/671211)

After a `SpeechSynthesisUtterance` ends naturally, Chrome sets
`window.speechSynthesis.paused = true`.  Any subsequent `speak()` call queues the
utterance, but because the engine is paused, it never plays.  This is a
well-known Chrome/Edge bug.

The code called `cancel()` and then `speak()` (with a 150 ms delay) but never
checked or cleared the paused state, so the second and all subsequent responses
were silently dropped.

Additionally, if `speakAssistantText` was called twice in quick succession, the
`setTimeout` from the first call could still be pending when the second started,
causing timer leaks.

## Fixes

### Fix 1 — Language persistence

Remove `localStorage.setItem` from the `[speechLang]` useEffect entirely.
Instead, write to localStorage directly in the `<select onChange>` handler.
This fires only when the user explicitly changes the dropdown — never on mount.

The `[speechLang]` effect now only syncs `speechLangRef.current` (no storage
writes):

```typescript
useEffect(() => {
  speechLangRef.current = speechLang;
}, [speechLang]);
```

The `onChange` handler:
```typescript
onChange={(e) => {
  const lang = e.target.value;
  setSpeechLang(lang);
  speechLangRef.current = lang;          // immediate sync for setTimeout
  localStorage.setItem(VOICE_LANG_KEY, lang);
}}
```

The `[]` load effect already correctly reads and applies the saved value on mount
without interfering with this flow.

### Fix 2 — Repeat TTS

Two changes:

**a) `resume()` before `speak()`** — added `paused` and `resume()` to the
`JarvisSpeechSynthesis` type shim; `speakAssistantText` now calls
`speechSynthesis.resume()` inside the 150 ms timeout if the engine reports
`paused === true`:

```typescript
if (jwLate.speechSynthesis.paused) {
  jwLate.speechSynthesis.resume();
}
```

**b) `speechTimerRef`** — a new `useRef<ReturnType<typeof setTimeout> | null>`
that holds the pending timer id.  Before starting a new delay,
`speakAssistantText` cancels any existing timer.  `stopVoice()`,
the `speakReplies`-off effect, and the unmount cleanup also clear the timer so
no queued utterance can play after speech was intentionally stopped.

## Changes

### `apps/web/src/components/ChatPanel.tsx`

- `JarvisSpeechSynthesis` interface: added `readonly paused: boolean` and `resume()`.
- Added `speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)`.
- `[speechLang]` effect: removed `localStorage.setItem` (ref sync only).
- `<select onChange>`: added direct `localStorage.setItem` and `speechLangRef.current` update.
- `speakAssistantText`: uses `speechTimerRef` for the setTimeout; calls `resume()` when paused; clears any pending timer before starting a new one.
- `stopVoice()`: clears `speechTimerRef` before cancelling synthesis.
- `speakReplies`-off effect: clears `speechTimerRef`.
- Unmount cleanup effect: clears `speechTimerRef`.

## What is NOT changed

| Property | Status |
|---|---|
| Proposal JSON not spoken | Unchanged |
| Mic input / recognition | Unchanged |
| Write-with-approval flow | Unchanged |
| Normal chat streaming | Unchanged |
| Backend / API routes | Unchanged |
| Voice bar UI layout | Unchanged |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | All fixes above |
| `docs/decisions/038-fix-voice-persistence-and-repeat-tts.md` | This document |

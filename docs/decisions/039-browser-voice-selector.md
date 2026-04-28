# Decision 039 — Browser Voice Selector (v0.5.2)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.5.1 added speech language selection (Swedish/English) and fixed repeat TTS.
The user wanted a more "Jarvis-like" sounding voice and needed a way to browse
and audition the browser/system voices that are already available — without
connecting to any external TTS service.

## Design

### Voice list source

Voices come exclusively from `window.speechSynthesis.getVoices()`.
These are the voices installed on the user's operating system and/or bundled with
the browser (e.g. Microsoft voices on Windows, Google voices in Chrome, system
voices on macOS).  No external API is used.

### Asynchronous voice loading

Chrome and Edge load voices asynchronously.  A `voiceschanged` event listener
on `speechSynthesis` is attached in a dedicated `useEffect` so the voice list
updates when the browser finishes loading.  The listener is removed on unmount.
Firefox and some Safari versions return voices synchronously from the first call.

### Persistence

The selected voice is stored by its `name` string under key `jarvis.voice.name.v1`
in localStorage.  The same write-in-handler pattern (not in a useEffect) used for
the language key is applied here to avoid first-mount overwrites.

On load:
1. The voice `useEffect` runs after mount.
2. It calls `getVoices()` — may be empty initially.
3. The saved name is read from localStorage.
4. When voices are available (synchronously or via `voiceschanged`), the list is
   stored in state and the saved name is matched against it.
5. If the name matches, `selectedVoiceName` and `selectedVoiceNameRef` are updated.
6. If the voice no longer exists, selection falls back silently to "Browser default".

### Apply voice to utterances

`speakAssistantText` now looks up the voice from `getVoices()` at speak time
(inside the 150 ms delay) rather than caching it.  This ensures the freshest
list is used and handles edge cases where voices change between responses.

`speakPreview` follows the identical pattern.

### `selectedVoiceNameRef`

Mirrors `selectedVoiceName` via a `useEffect` — same pattern as `speechLangRef`
and `speakRepliesRef`.  This lets the `setTimeout` inside `speakAssistantText`
always read the current name without stale closure issues.

### Test voice button

A "Test voice" button appears in the voice bar.  Clicking it speaks a short
preview phrase in the currently selected language using the selected voice.
The phrase is picked from `VOICE_PREVIEW_PHRASES`:
- `en-US`: `"Hello Jimmy. Jarvis voice preview."`
- `sv-SE`: `"Hej Jimmy. Detta är en röstförhandsvisning."`

The preview uses the same `cancel → delay → resume-if-paused → speak` pattern
as `speakAssistantText` so it works reliably in Chrome and Edge.  It does NOT
check `speakRepliesRef` — it is an explicit user action, not an auto-reply.

## JarvisUtterance / JarvisSpeechSynthesis shim updates

Added `JarvisVoice { name, lang }` interface.  Added `voice: JarvisVoice | null`
to `JarvisUtterance`.  Added `getVoices(): JarvisVoice[]` and
`onvoiceschanged: (() => void) | null` to `JarvisSpeechSynthesis`.

All types remain local to `ChatPanel.tsx` — no DOM lib globals relied upon.

## What is NOT changed

| Property | Status |
|---|---|
| Language selection and persistence | Unchanged |
| Repeat TTS fix (resume/timer) | Unchanged |
| Proposal JSON not spoken | Unchanged |
| Mic recognition (lang only) | Unchanged — voice selector does not affect recognition |
| Write-with-approval flow | Unchanged |
| Backend / API routes | Unchanged |
| External APIs | Not added |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | `JarvisVoice` + shim updates; `VOICE_NAME_KEY` + `VOICE_PREVIEW_PHRASES` constants; `availableVoices`, `selectedVoiceName`, `selectedVoiceNameRef` state/refs; voice-loading `useEffect`; `selectedVoiceNameRef` sync effect; `speakAssistantText` applies voice; `speakPreview` function; voice selector row + Test voice button in JSX |
| `docs/decisions/039-browser-voice-selector.md` | This document |
| `README.md` | Short note added |

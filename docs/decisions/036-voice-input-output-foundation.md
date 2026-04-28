# Decision 036 — Voice Input / Output Foundation (v0.5.0)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

Jarvis v0.5 adds voice as a first-class interaction mode. The goal is to allow
hands-free dictation into the chat input and to have Jarvis read its replies
aloud — without adding any cloud speech services, wake-word listeners, or
always-on microphone access.

## Design

All voice functionality lives in `ChatPanel.tsx` only. No new API routes, no
new components, no cloud providers.

### Voice input (microphone)

- Uses the **Web Speech API** (`window.SpeechRecognition` / `window.webkitSpeechRecognition`).
- `continuous: false` and `interimResults: false` — one short utterance at a time.
- Recognised transcript is **appended** to the current input text; nothing is sent automatically.
- The textarea height is recalculated after appending so the auto-grow still works.
- A mic button appears in the input bar (hidden while a response is streaming).
- States: default (supported), listening (pulsing red), and unsupported (dimmed).
- Errors are shown as inline hint text beneath the input bar:
  - `"not-allowed"` → microphone permission denied.
  - `"no-speech"` / `"aborted"` → cleared silently.
  - other → generic error string from the event.
- `recognitionRef` (a `useRef`) holds the active recognition instance so it can
  be stopped or aborted on component unmount.

### Text-to-speech (TTS)

- Uses the **Web Speech Synthesis API** (`window.speechSynthesis` + `SpeechSynthesisUtterance`).
- Off by default. A small toggle button appears below the input bar when TTS is
  available in the browser (`ttsSupported`).
- When enabled, Jarvis speaks each new assistant response after it finishes streaming.
- For responses that contain a `jarvis-write-proposal` block, the spoken text is
  replaced with a safe neutral summary:
  `"Jarvis proposed a workspace file change. Review it before approving."`
  (avoids reading out a raw JSON block or file content).
- Toggle-off immediately cancels any in-progress speech (`speechSynthesis.cancel()`).
- A `"Speaking…"` hint is shown while TTS is active.

## TypeScript compatibility

`SpeechRecognition` and related types are **not** available as global type names
in the TypeScript 5.9.3 + Next.js 14 build-time checker (even though they exist
at runtime in Chrome/Edge/Safari). `npm run lint` (ESLint only) passes but
`npm run build` (which runs `tsc`) fails with `"Cannot find name 'SpeechRecognition'"`.

**Fix**: define a complete minimal local interface set at the top of `ChatPanel.tsx`:

- `JarvisRecognitionAlternative`, `JarvisRecognitionResult`, `JarvisRecognitionResultList`
- `JarvisRecognitionEvent`, `JarvisRecognitionErrorEvent`
- `JarvisRecognition`, `JarvisRecognitionCtor`
- `JarvisUtterance`, `JarvisUtteranceCtor`, `JarvisSpeechSynthesis`
- `JarvisWindow = Window & { SpeechRecognition?, webkitSpeechRecognition?, speechSynthesis?, SpeechSynthesisUtterance? }`

All runtime window access uses `window as unknown as JarvisWindow`. No `declare global` blocks.

## Changes

### `apps/web/src/components/ChatPanel.tsx`

- Local Speech API type shims (module-level, after imports).
- New state: `voiceSupported`, `voiceListening`, `voiceError`, `ttsSupported`, `speakReplies`, `speaking`.
- New ref: `recognitionRef`.
- `toggleVoiceInput()` — starts/stops recognition; builds and manages the recognition instance.
- Support-detection `useEffect` — runs once on mount, checks `window` for APIs.
- `speakReplies`-off `useEffect` — cancels in-progress speech when TTS is toggled off.
- Cleanup `useEffect` — extended to abort recognition and cancel speech on unmount.
- TTS call in `send()` — runs after `detectAndPropose`, uses proposal-safe text.
- Mic button added to input bar (hidden while loading).
- TTS toggle + status hints added below input bar.

## What is NOT changed

| Property | Status |
|---|---|
| Write-with-approval flow | Unchanged |
| Existing chat, streaming, cancel | Unchanged |
| WorkspacePanel, ActivityPanel, page.tsx | Unchanged |
| Backend / API routes | Unchanged |
| Email sending, SMTP, OAuth | Not added |
| Wake word / always-on listening | Not added |
| Cloud speech services | Not added |
| Auto-send on voice result | Not added |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | All voice features |
| `docs/decisions/036-voice-input-output-foundation.md` | This document |
| `README.md` | Short note added |

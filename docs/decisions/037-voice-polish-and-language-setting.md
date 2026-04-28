# Decision 037 — Voice UI Polish and Speech Language Setting (v0.5.1)

**Date:** 2026-04-28  
**Status:** Accepted and implemented

## Context

v0.5.0 added browser voice input (mic) and text-to-speech voice replies.
The voice controls were functional but scattered:

- Mic button: in the button row (fine).
- TTS toggle: in the keyboard-hint row (hard to notice).
- Speaking/Listening status: as bare paragraph lines below the form.
- Language: hardcoded to `"en-US"` in `recognition.lang` — the user is Swedish and
  needs `sv-SE` support as well.

v0.5.1 reorganises the voice controls into a compact voice bar and adds a
persistent speech language selector.

## Design

### Language selector

A `<select>` dropdown with two options:

| Label | Value |
|---|---|
| Swedish (sv-SE) | `sv-SE` |
| English (en-US) | `en-US` |

Default: `sv-SE`.

The selected value is persisted to `localStorage` under key `jarvis.voice.lang.v1`
and restored on page load. Only known option values are accepted from storage to
prevent stale or injected data.

The value is applied to:
- `SpeechRecognition.lang` — at the moment `toggleVoiceInput()` starts a new
  recognition session (reads directly from the `speechLang` React state at call time).
- `SpeechSynthesisUtterance.lang` — inside the 150 ms `setTimeout` in
  `speakAssistantText()` (reads from `speechLangRef.current` so the latest value
  is always used even when the language is changed between the cancel() and speak()
  calls).

### `speechLangRef`

A `useRef` mirrors `speechLang` state, kept in sync by a `useEffect`. This is the
same pattern used by `speakRepliesRef` (added in v0.5.0) to avoid stale closures
in async/timeout contexts.

### JarvisUtterance type shim

`lang: string` was added to the local `JarvisUtterance` interface so that
`utterance.lang = ...` compiles without relying on DOM globals.

### Voice bar JSX

The voice controls are now grouped in a compact section below the keyboard-hint
row, only rendered when at least one voice API is available:

```
┌───────────────────────────────────────────────────────────────┐
│ Speech: [Swedish (sv-SE) ▾]         Voice replies: off/on      │
│ Listening… / voice error / speech error (conditional lines)    │
└───────────────────────────────────────────────────────────────┘
```

While speaking, the right side switches from the toggle to:
```
Speaking…   [Stop voice]
```

The TTS toggle was removed from the keyboard-hint row and integrated here.

## Changes

### `apps/web/src/components/ChatPanel.tsx`

- Added `VOICE_LANG_KEY`, `VOICE_LANG_OPTIONS`, `VOICE_LANG_DEFAULT` module constants.
- Added `lang: string` to `JarvisUtterance` local interface.
- Added `speechLang` state and `speechLangRef` ref.
- Support-detection `useEffect` now also reads and validates the saved language from
  localStorage, updating both state and ref.
- New `speechLang` persistence `useEffect` — keeps ref in sync, writes to localStorage.
- `toggleVoiceInput`: `recognition.lang = speechLang` (was hardcoded `"en-US"`).
- `speakAssistantText`: `utterance.lang = speechLangRef.current` added before `speak()`.
- Hint row: TTS toggle removed (moved to voice bar).
- New compact voice bar: language `<select>` + TTS toggle (or speaking status).
- Status lines (Listening…, voice error, speech error) moved inside voice bar.

## What is NOT changed

| Property | Status |
|---|---|
| Mic button in input row | Unchanged |
| Write-with-approval flow | Unchanged |
| Streaming / cancel | Unchanged |
| Proposal JSON not spoken | Unchanged |
| No wake word / always-on | Not added |
| No cloud speech services | Not added |
| Backend / API routes | Unchanged |
| WorkspacePanel, ActivityPanel, page.tsx | Unchanged |

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ChatPanel.tsx` | Language constants; `JarvisUtterance.lang`; `speechLang` state + ref; support/persist effects; `toggleVoiceInput`; `speakAssistantText`; voice bar JSX |
| `docs/decisions/037-voice-polish-and-language-setting.md` | This document |
| `README.md` | Short note added |

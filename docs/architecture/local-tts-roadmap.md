# Local TTS Roadmap

**Last updated:** 2026-04-28  
**Status:** Architecture placeholder — not yet implemented

## Goal

Replace or supplement the browser Web Speech API with a local TTS server so that:

- Voice quality is consistent across all browsers (no voice-pack variance).
- Swedish and English voices are available on headless or locked-down systems.
- No cloud TTS provider is ever called.

## Provider abstraction (v0.5.3)

`ChatPanel.tsx` now routes TTS calls through a `TtsProvider` type:

```typescript
type TtsProvider = "browser" | "local";
```

`speakAssistantText(text)` dispatches to either `speakWithBrowserTts(text)` or
`speakWithLocalTts()` based on `ttsProviderRef.current`.  The user selects the
provider via a dropdown in the voice bar; the choice persists to localStorage
under `jarvis.voice.provider.v1`.

`speakWithLocalTts()` is currently a placeholder that surfaces an error message.
No HTTP call is made.

## Candidate local TTS servers

| Engine | License | Swedish | English | Notes |
|--------|---------|---------|---------|-------|
| [Kokoro](https://github.com/hexgrad/kokoro) | Apache-2.0 | ✗ | ✓ | Lightweight, good English quality |
| [Piper](https://github.com/rhasspy/piper) | MIT | ✓ | ✓ | Many voices including sv-SE ONNX models |
| [Coqui TTS](https://github.com/coqui-ai/TTS) | MPL-2.0 | partial | ✓ | Larger, more capable, heavier runtime |

**Recommended first integration: Piper** — MIT licensed, ships pre-built binaries
for Windows/Linux/macOS, has published Swedish ONNX models (`sv_SE-nst-medium`),
and exposes a simple HTTP server (`--output_file` or `--output_pipe` mode with a
JSON API wrapper).

## Planned integration steps

1. **API route** — add `POST /tts/speak` to `apps/api` that:
   - Accepts `{ text: string; lang: string; voice?: string }`.
   - Pipes text to a locally running Piper process (or Kokoro).
   - Returns audio as `audio/wav` or `audio/mpeg`.
   - Configurable via `LOCAL_TTS_URL` env var (e.g. `http://localhost:5500`).

2. **Frontend `speakWithLocalTts`** — replace the placeholder with:
   - `fetch(API_URL + "/tts/speak", { method: "POST", body: JSON.stringify({ text, lang: speechLangRef.current }) })`
   - Convert the response `Blob` to an `AudioBuffer` via `AudioContext.decodeAudioData`.
   - Play through `AudioContext.createBufferSource` — no SpeechSynthesis involved.
   - Wire `setSpeaking(true/false)` around play start/end.

3. **Voice selector** — when the local provider is active, replace the browser
   voice `<select>` with a list of available Piper voices fetched from
   `GET /tts/voices`.

4. **Env vars** needed:
   ```
   LOCAL_TTS_URL=http://localhost:5500   # Piper HTTP wrapper
   LOCAL_TTS_ENGINE=piper                # "piper" | "kokoro"
   ```

## What is NOT changed by this roadmap

- Browser TTS (`speakWithBrowserTts`) stays exactly as-is.  Users who do not run
  a local TTS server continue to use browser voices without any difference.
- Mic input is always browser SpeechRecognition — not affected by the TTS provider.
- No cloud TTS provider is ever added.

# Local TTS Roadmap

**Last updated:** 2026-04-29  
**Status:** Official Piper URLs selected and verified (v0.5.9) — run the setup script to download and install locally

## Goal

Replace or supplement the browser Web Speech API with a local TTS server so that:

- Voice quality is consistent across all browsers (no voice-pack variance).
- Swedish and English voices are available on headless or locked-down systems.
- No cloud TTS provider is ever called.

## Provider abstraction (v0.5.3) and HTTP route (v0.5.4)

`ChatPanel.tsx` routes TTS calls through a `TtsProvider` type:

```typescript
type TtsProvider = "browser" | "local";
```

`speakAssistantText(text)` dispatches to either `speakWithBrowserTts(text)` or
`speakWithLocalTts(text)` based on `ttsProviderRef.current`.  The user selects the
provider via a dropdown in the voice bar; the choice persists to localStorage
under `jarvis.voice.provider.v1`.

As of v0.5.4, `speakWithLocalTts` is fully wired:

- Calls `POST /tts/speak` on the Jarvis API (never the local TTS server directly).
- If the API returns `audio/*` bytes, plays them via `HTMLAudioElement`.
- If the API returns JSON error, shows it in the speech error row.
- `stopVoice()` and the Voice replies toggle stop local audio via `audioRef`.

The route `POST /tts/speak` is disabled by default (`LOCAL_TTS_ENABLED=false`).
Set `LOCAL_TTS_ENABLED=true` in `apps/api/.env` and point `LOCAL_TTS_BASE_URL`
to the running local TTS server to activate it.

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

## Integration steps

1. **API route** ✓ — `POST /tts/speak` exists in `apps/api/src/routes/tts.ts`:
   - Disabled by default (`LOCAL_TTS_ENABLED=false`).
   - When enabled, forwards to `LOCAL_TTS_BASE_URL/speak` (localhost-only).
   - Returns audio bytes or a JSON error.

2. **Frontend** ✓ — `speakWithLocalTts(text)` in `ChatPanel.tsx` calls the route and plays the audio.

3. **Setup guide and mock server** ✓ (v0.5.5):
   - `docs/setup/local-tts-server.md` — architecture, safety rules, Piper/Kokoro
     overview, env config, POST /speak contract, step-by-step test instructions.
   - `scripts/local-tts-mock-server.mjs` — zero-dependency Node.js mock server
     that returns a 440 Hz WAV beep so the full transport path can be tested
     without installing Piper or Kokoro.  Run with `npm run dev:tts-mock`.

4. **Piper HTTP wrapper** ✓ (v0.5.6):
   - `scripts/local-tts-piper-server.mjs` — zero-dependency Node.js wrapper.
   - Spawns the Piper binary, passes text via stdin, reads `--output_file` WAV.
   - Run with `npm run dev:tts-piper` after setting `PIPER_BIN` and `PIPER_VOICE_MODEL`.
   - Piper binary and `.onnx` models are downloaded separately (never committed).
   - Full setup instructions in `docs/setup/local-tts-server.md` section H.

5. **Windows setup helper** ✓ (v0.5.7):
   - `scripts/setup-piper-windows.ps1` — optional PowerShell script.
   - Creates `local-tts/piper/` and `local-tts/voices/` (gitignored).
   - Downloads Piper zip and extracts it; downloads `.onnx` + `.onnx.json` model.
   - Exits early with instructions if URL placeholders are not filled in first.
   - Prints exact `$env:` commands and `.env` settings after successful setup.
   - No binaries or models are bundled — script downloads them on demand.
   - `docs/setup/local-tts-piper-env-example.ps1` — reference for env var setup.
   - `docs/setup/local-tts-server.md` section I — full explanation.

6. **Piper setup checklist** ✓ (v0.5.8/v0.5.9):
   - `docs/setup/piper-windows-checklist.md` — complete step-by-step guide.
   - Covers official URL sources (GitHub releases, HuggingFace piper-voices).
   - Voice selection guidance — clear/calm English, no movie imitation.
   - How to fill `scripts/setup-piper-windows.ps1` URL variables.
   - Start wrapper, connect API, test commands, cleanup instructions.
   - Setup script updated to reference checklist in its placeholder error output.

7. **Official URL selection** ✓ (v0.5.9):
   - Piper release `2023.11.14-2` — latest release (repo archived Oct 2025, still valid).
   - `piper_windows_amd64.zip` URL verified HTTP 200 via HEAD request.
   - Voice selected: `en_GB-alan-medium` — British English male, medium quality.
   - Both HuggingFace `.onnx` and `.onnx.json` URLs verified HTTP 200.
   - URLs pre-filled in `scripts/setup-piper-windows.ps1` — no placeholders remain.
   - `-DryRun` parameter added to script for safe preview before download.
   - Next step: run `powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1`

8. **Voice selector** — when the local provider is active, optionally replace the
   browser voice `<select>` with a list of available Piper/Kokoro voices fetched
   from `GET /tts/voices` (a future endpoint).

5. **Env vars needed to activate:**
   ```
   LOCAL_TTS_ENABLED=true
   LOCAL_TTS_BASE_URL=http://localhost:5005   # Piper HTTP wrapper
   LOCAL_TTS_PROVIDER=piper                   # informational label
   ```

## What is NOT changed by this roadmap

- Browser TTS (`speakWithBrowserTts`) stays exactly as-is.  Users who do not run
  a local TTS server continue to use browser voices without any difference.
- Mic input is always browser SpeechRecognition — not affected by the TTS provider.
- No cloud TTS provider is ever added.

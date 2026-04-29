# Local TTS Server Setup

This guide explains how to connect Jarvis to a local text-to-speech server so
that voice replies are generated on-device instead of (or in addition to) the
built-in browser Web Speech API.

**Local TTS is optional and disabled by default.**
Browser voice works out-of-the-box with no extra configuration.

---

## A. Architecture

```
Jarvis UI (ChatPanel)
  │
  │  selects: "Local TTS"
  │
  ▼
Jarvis API — POST http://localhost:4000/tts/speak
  │
  │  forwards (when LOCAL_TTS_ENABLED=true):
  │  POST ${LOCAL_TTS_BASE_URL}/speak
  │
  ▼
Local TTS server (Piper / Kokoro / mock)
  │
  │  returns: audio bytes  (Content-Type: audio/wav  or  audio/mpeg)
  │
  ▼
Jarvis API — streams audio bytes back to frontend
  │
  ▼
Jarvis UI — plays audio via HTMLAudioElement
```

Key points:

- The **frontend never calls the local TTS server directly** — all traffic goes
  through the Jarvis API route `/tts/speak`.
- If the local server is not running or `LOCAL_TTS_ENABLED=false`, a friendly
  error is shown in the UI.  No crash, no silent failure.
- **Browser voice** (Web Speech API) remains the default and is completely
  independent of this setup.

---

## B. Safety rules

| Rule | Detail |
|---|---|
| Disabled by default | `LOCAL_TTS_ENABLED` defaults to `false` — safe to deploy without a TTS server |
| localhost-only | `LOCAL_TTS_BASE_URL` must be `localhost`, `127.0.0.1`, or `::1`. Remote URLs are rejected at API startup. |
| No cloud TTS | No request ever leaves your machine |
| No API keys | No credentials required |
| No voice cloning | Do not attempt to replicate any real person's voice |
| Model files | Never commit `.onnx`, `.bin`, `.pt`, audio clips, or voice pack files to the repo |
| `.env` files | Never commit `apps/api/.env` — it is gitignored |

---

## C. Recommended TTS engines

### Piper (recommended first option)

[Piper](https://github.com/rhasspy/piper) is a lightweight, MIT-licensed local
TTS engine that runs on CPU.  It ships pre-built binaries for Windows, Linux,
and macOS, and includes Swedish (`sv_SE-nst-medium`) and English voice models.

Why Piper first:
- No GPU required
- Small binary, small ONNX model files (~60–100 MB per voice)
- HTTP server mode available (via a thin wrapper)
- Swedish support out of the box

### Kokoro (future higher-quality option)

[Kokoro](https://github.com/hexgrad/kokoro) produces higher-quality English
voices but currently has limited Swedish support and a heavier runtime.
Consider it after Piper is working.

### Browser voice (current default)

The browser Web Speech API (`window.speechSynthesis`) is always available as
the default.  It uses OS/browser voices, requires no server, and works
immediately.  Switch to it any time by selecting "Browser voice" in the UI.

---

## D. Environment configuration

Create a local environment file (never committed):

```
apps/api/.env
```

Add the following:

```env
LOCAL_TTS_ENABLED=true
LOCAL_TTS_BASE_URL=http://localhost:5005
LOCAL_TTS_PROVIDER=piper
```

| Variable | Default | Description |
|---|---|---|
| `LOCAL_TTS_ENABLED` | `false` | Set to `true` to activate the proxy route |
| `LOCAL_TTS_BASE_URL` | `http://localhost:5005` | URL of the local TTS server (localhost only) |
| `LOCAL_TTS_PROVIDER` | `generic` | Informational label — `piper`, `kokoro`, `mock`, etc. |

After creating or changing `.env`, **restart the Jarvis API**:

```bash
npm run dev:api
# or restart the full stack:
npm run dev
```

To disable local TTS again:

```env
LOCAL_TTS_ENABLED=false
```

Or simply delete `apps/api/.env` — the defaults are safe.

---

## E. Expected local TTS server contract

Any HTTP server that implements this contract will work with Jarvis:

**Request:**

```
POST /speak
Content-Type: application/json

{
  "text":  "Hello Jimmy.",
  "lang":  "en-US",
  "voice": "optional-voice-name"
}
```

- `text` — the string to speak (required)
- `lang` — BCP-47 language tag, e.g. `sv-SE`, `en-US` (optional, may be ignored)
- `voice` — voice name hint (optional, may be ignored)

**Success response:**

```
HTTP 200
Content-Type: audio/wav   (or audio/mpeg)

<raw audio bytes>
```

**Error response (optional):**

```
HTTP 4xx / 5xx
Content-Type: application/json

{ "error": "Something went wrong." }
```

---

## F. Manual test steps (with a real local server)

1. Start the Jarvis stack:
   ```bash
   npm run dev
   ```

2. Start your local TTS server on port 5005 (see engine-specific instructions).

3. Create `apps/api/.env`:
   ```env
   LOCAL_TTS_ENABLED=true
   LOCAL_TTS_BASE_URL=http://localhost:5005
   LOCAL_TTS_PROVIDER=piper
   ```

4. Restart the API if it was already running.

5. Open http://localhost:3000

6. In the voice bar, select **TTS: Local TTS**.

7. Click **Test voice** — you should hear audio from the local server.

8. Enable **Voice replies** and send a message.  The response should be spoken
   by the local server instead of the browser.

9. Click **Stop voice** — audio should stop immediately.

---

## F2. Test with the development mock server (no real TTS needed)

Jarvis ships a tiny mock server that returns a 440 Hz beep WAV.
This lets you test the full transport path without installing Piper or Kokoro.

**Terminal 1 — mock TTS server:**
```bash
npm run dev:tts-mock
```

**`apps/api/.env`:**
```env
LOCAL_TTS_ENABLED=true
LOCAL_TTS_BASE_URL=http://localhost:5005
LOCAL_TTS_PROVIDER=mock
```

**Terminal 2 — Jarvis stack:**
```bash
npm run dev
```

Open http://localhost:3000, select **TTS: Local TTS**, click **Test voice**.
You should hear a short beep.  The mock server logs each `/speak` call.

---

## G. Cleanup

When you are done testing local TTS:

1. Stop the local TTS server or mock server (Ctrl+C).

2. Either delete `apps/api/.env` or disable local TTS:
   ```env
   LOCAL_TTS_ENABLED=false
   ```

3. The voice bar will revert to showing a "not enabled" error for Local TTS.
   Switch to **Browser voice** for normal operation.

4. **Never commit:**
   - `apps/api/.env`
   - `.onnx`, `.bin`, `.pt`, or other model weight files
   - Voice pack directories
   - Generated audio files (`.wav`, `.mp3`)

   The `.gitignore` already excludes `.env` files.  Add voice/model directories
   to `.gitignore` before downloading them.

---

## H. Piper setup (Windows, step-by-step)

Jarvis ships a ready-made Piper HTTP wrapper at `scripts/local-tts-piper-server.mjs`.
No npm packages — it uses Node.js built-ins only.

### 1. Download the Piper binary

1. Go to https://github.com/rhasspy/piper/releases
2. Download the latest Windows release, e.g. `piper_windows_amd64.zip`
3. Unzip it into the repo's `local-tts/piper/` directory (gitignored):

   ```
   Jarvis/
   └── local-tts/
       └── piper/
           ├── piper.exe
           └── (supporting DLLs, espeak-ng-data/, etc.)
   ```

### 2. Download a voice model

1. Go to https://huggingface.co/rhasspy/piper-voices
2. Navigate to the voice you want, e.g. `en/en_GB/alan/medium/`
3. Download both files:
   - `en_GB-alan-medium.onnx`
   - `en_GB-alan-medium.onnx.json`
4. Place them in `local-tts/voices/` (gitignored):

   ```
   Jarvis/
   └── local-tts/
       └── voices/
           ├── en_GB-alan-medium.onnx
           └── en_GB-alan-medium.onnx.json
   ```

   Swedish voices: `sv/sv_SE/nst/medium/sv_SE-nst-medium.onnx`
   English (US):   `en/en_US/lessac/medium/en_US-lessac-medium.onnx`

### 3. Set environment variables and start the wrapper

**PowerShell:**

```powershell
$env:PIPER_BIN="C:\path\to\Jarvis\local-tts\piper\piper.exe"
$env:PIPER_VOICE_MODEL="C:\path\to\Jarvis\local-tts\voices\en_GB-alan-medium.onnx"
npm run dev:tts-piper
```

**Bash (Git Bash / WSL):**

```bash
PIPER_BIN="C:/path/to/Jarvis/local-tts/piper/piper.exe" \
PIPER_VOICE_MODEL="C:/path/to/Jarvis/local-tts/voices/en_GB-alan-medium.onnx" \
npm run dev:tts-piper
```

The server starts on `http://127.0.0.1:5005`.

### 4. Configure the Jarvis API

In `apps/api/.env`:

```env
LOCAL_TTS_ENABLED=true
LOCAL_TTS_BASE_URL=http://localhost:5005
LOCAL_TTS_PROVIDER=piper
```

### 5. Test

```bash
# Quick status check
curl http://localhost:5005/

# Synthesise speech (saves response to test.wav)
curl -X POST http://localhost:5005/speak \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"Hello Jimmy.\"}" \
  --output test.wav
```

Open `test.wav` — you should hear the voice.

Then restart the Jarvis API (`npm run dev:api`), open http://localhost:3000,
select **TTS: Local TTS**, and click **Test voice**.

### Optional Piper environment variables

| Variable | Description |
|---|---|
| `PIPER_SERVER_PORT` | Port to listen on (default: 5005) |
| `PIPER_VOICE_CONFIG` | Path to `.onnx.json` (auto-detected if next to `.onnx`) |
| `PIPER_NOISE_SCALE` | Voice variation (float, e.g. `0.667`) |
| `PIPER_LENGTH_SCALE` | Speech rate (float, `1.0` = normal) |
| `PIPER_NOISE_W` | Phoneme width variation (float) |

---

## I. v0.5.7 Windows setup helper script (optional)

Jarvis ships an optional PowerShell helper script that automates the manual
steps from section H (directory creation, binary download, extraction, model
download).

**Script location:** `scripts/setup-piper-windows.ps1`

### What it does

1. Creates `local-tts/piper/` and `local-tts/voices/` inside the repo (both gitignored).
2. Downloads the Piper Windows release zip (only if not already present).
3. Extracts the zip into `local-tts/piper/`.
4. Downloads the configured voice model `.onnx` and `.onnx.json` (only if not already present).
5. Prints the exact `$env:` commands and `apps/api/.env` settings you need.

### Important — fill in the URLs first

The script contains three URL placeholder variables near the top:

```powershell
$PiperZipUrl    = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_RELEASE>"
$VoiceModelUrl  = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_VOICE>"
$VoiceConfigUrl = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_VOICE_CONFIG>"
```

**The script will not download anything until these are replaced with real URLs.**
It exits with a clear error message and instructions if any placeholder is still present.

Find official URLs at:
- Piper binary: https://github.com/rhasspy/piper/releases → download `piper_windows_amd64.zip`
- Voice models: https://huggingface.co/rhasspy/piper-voices → navigate to a voice folder

### How to run

From the repo root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1
```

The script does nothing destructive — it skips files that already exist and never
overwrites without prompting.

### After the script completes

The script prints all the commands you need.  In short:

1. Set the env vars it prints and run `npm run dev:tts-piper`.
2. Add the `.env` settings it prints to `apps/api/.env`.
3. Restart `npm run dev:api`.
4. Open http://localhost:3000, select **TTS: Local TTS**, click **Test voice**.

For a reference of all the env vars, see `docs/setup/local-tts-piper-env-example.ps1`.

### Safety reminders

- `local-tts/` is gitignored — Piper binaries and models will never be committed.
- `*.onnx`, `*.onnx.json`, `*.wav`, `*.mp3` are all gitignored.
- `apps/api/.env` is gitignored — your local config is never committed.
- Run `git status` after setup to confirm nothing unexpected is staged.

---

## J. v0.5.8 Piper Windows checklist (step-by-step guide)

A dedicated step-by-step guide covering official URL selection, voice choice,
script setup, and local testing:

**`docs/setup/piper-windows-checklist.md`**

Read this before filling in the URL variables in the setup script.  It explains:

- Where to find official Piper release and voice URLs (sections C, D, F)
- Which voice to choose and voice direction notes (section E)
- How to fill in `scripts/setup-piper-windows.ps1` (section F)
- How to start the wrapper and test it (sections H, J)
- Cleanup and switching back to browser TTS (section K)

---

## K. v0.5.9 Official Piper URLs selected

As of v0.5.9, `scripts/setup-piper-windows.ps1` has real official URLs pre-filled
and verified (no placeholders remain):

| File | URL |
|---|---|
| Piper binary | `https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip` |
| Voice model | `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx` |
| Voice config | `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json` |

Voice selected: **`en_GB-alan-medium`** — British English male, medium quality.
Verified HTTP 200 via HEAD request on 2026-04-29.

The setup script also supports a `-DryRun` flag that prints all URLs and target
paths without downloading anything:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1 -DryRun
```

Setup remains manual — run the script yourself when you are ready to download.

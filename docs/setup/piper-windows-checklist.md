# Piper Windows Setup Checklist

This checklist guides you through installing Piper TTS locally for Jarvis on
Windows.  It covers where to find official files, which variables to fill in,
how to start the wrapper, and how to verify it works.

**Piper is optional.**  Jarvis works fine with browser TTS out of the box.
Follow this checklist only when you want on-device speech with consistent quality.

---

## A. What this checklist is for

- Installing Piper locally on your own machine for use with Jarvis.
- Keeping all binaries and voice models outside Git (never committed).
- Using only official Piper release sources — no third-party mirrors.
- Connecting Piper to Jarvis through the existing HTTP wrapper and API route.

---

## B. Safety rules

Before starting, commit these to memory:

| Rule | Detail |
|---|---|
| Never commit `local-tts/` | Piper binary, DLLs, voice data — all gitignored |
| Never commit `apps/api/.env` | Local environment config — gitignored |
| Never commit `*.onnx` / `*.onnx.json` | Voice model files — gitignored |
| Never commit `*.wav` / `*.mp3` | Generated audio — gitignored |
| No voice cloning | Do not attempt to replicate any real person's voice |
| No movie Jarvis imitation | Do not aim to recreate a fictional character's voice |
| Local-only | Piper runs on your machine; no audio leaves your device |
| No cloud TTS | No API keys, no external services, no internet TTS calls |

Run `git status` after any file additions to confirm nothing unexpected is staged.

---

## C. Official sources

Always download from official sources only.  Check these pages for the current
release — do not guess version numbers or use third-party mirrors.

| What | Official URL |
|---|---|
| Piper releases (binary) | https://github.com/rhasspy/piper/releases |
| Piper voice list | https://github.com/rhasspy/piper-voices |
| Piper voice files (HuggingFace) | https://huggingface.co/rhasspy/piper-voices |
| Piper documentation | https://github.com/rhasspy/piper |

---

## D. Files you need

You need three files before the setup script can run:

| File | What it is | Where to get it |
|---|---|---|
| `piper_windows_amd64.zip` | Piper binary + DLLs for Windows x64 | GitHub releases page — latest release assets |
| `<voice>.onnx` | Voice model weights (50-100 MB) | HuggingFace rhasspy/piper-voices |
| `<voice>.onnx.json` | Voice config (sample rate, phonemes) | Same folder as the `.onnx` file |

You do not need to download these manually — the setup script does it for you
once you fill in the download URLs.

---

## E. Choosing a voice

Piper has many voices.  For Jarvis, aim for:

- Clear, calm, and assistant-like delivery
- British English (en_GB) or American English (en_US)
- Medium quality (smaller file, still sounds good)
- Do not aim to clone or imitate any real person's voice
- Do not try to recreate the movie Jarvis character voice
- Try a few voices and pick what sounds right to you

Suggested starting points (verify these exist on the release page):

| Voice ID | Language | Style |
|---|---|---|
| `en_GB-alan-medium` | British English | Calm, clear |
| `en_US-lessac-medium` | American English | Neutral, clear |
| `en_US-ryan-medium` | American English | Natural |
| `sv_SE-nst-medium` | Swedish | Neural |

Browse https://github.com/rhasspy/piper-voices to hear samples and check
which voices are currently available.

---

## F. Filling in the setup script

Open `scripts/setup-piper-windows.ps1` in any text editor and find the three
URL variables near the top (around line 55):

```powershell
$PiperZipUrl    = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_RELEASE>"
$VoiceModelUrl  = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_VOICE>"
$VoiceConfigUrl = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_VOICE_CONFIG>"
```

Also update the file name variables below them to match the voice you chose:

```powershell
$VoiceModelName  = "en_GB-alan-medium.onnx"
$VoiceConfigName = "en_GB-alan-medium.onnx.json"
```

### How to find the correct URLs

**Piper binary URL:**

1. Go to https://github.com/rhasspy/piper/releases
2. Click the latest release
3. Under "Assets", find `piper_windows_amd64.zip`
4. Right-click the download link and copy the URL
5. Paste it as `$PiperZipUrl`

The URL pattern looks like:

```
https://github.com/rhasspy/piper/releases/download/<version-tag>/piper_windows_amd64.zip
```

**Voice model URLs:**

1. Go to https://huggingface.co/rhasspy/piper-voices/tree/main
2. Navigate into the language folder (e.g. `en/en_GB/alan/medium/`)
3. Click the `.onnx` file — then click the download icon to get the direct URL
4. Do the same for the `.onnx.json` file
5. Paste the two URLs as `$VoiceModelUrl` and `$VoiceConfigUrl`

The URL pattern looks like:

```
https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx
https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json
```

---

## G. Running the setup script

From the Jarvis repo root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1
```

The script will:

1. Print a banner with the target directory paths.
2. Exit immediately with instructions if any URL is still a placeholder.
3. Create `local-tts/piper/` and `local-tts/voices/` (if not already present).
4. Download `piper_windows_amd64.zip` into `local-tts/piper/`.
5. Extract the zip.
6. Download the `.onnx` and `.onnx.json` voice files into `local-tts/voices/`.
7. Print exact `$env:` commands and `.env` settings for next steps.

If any file is already present, it is skipped — safe to re-run.

---

## H. Starting the Piper wrapper server

After the setup script completes, it will print the exact commands for your
machine.  The general form is:

```powershell
$env:PIPER_BIN="C:\Users\Jimmy\Documents\GitHub\Jarvis\local-tts\piper\piper.exe"
$env:PIPER_VOICE_MODEL="C:\Users\Jimmy\Documents\GitHub\Jarvis\local-tts\voices\en_GB-alan-medium.onnx"
$env:PIPER_VOICE_CONFIG="C:\Users\Jimmy\Documents\GitHub\Jarvis\local-tts\voices\en_GB-alan-medium.onnx.json"
npm run dev:tts-piper
```

Keep this terminal open — the server runs in the foreground.

The Piper wrapper starts at `http://127.0.0.1:5005` and logs each request.

For a full reference of all optional env vars (`PIPER_NOISE_SCALE`, etc.), see:
`docs/setup/local-tts-piper-env-example.ps1`

---

## I. Connecting the Jarvis API

Create or update `apps/api/.env` (never committed):

```env
LOCAL_TTS_ENABLED=true
LOCAL_TTS_BASE_URL=http://localhost:5005
LOCAL_TTS_PROVIDER=piper
```

Then restart the Jarvis API in a separate terminal:

```powershell
npm run dev:api
```

Or restart the full stack:

```powershell
npm run dev
```

---

## J. Test commands

### Quick status check (confirm wrapper is running)

PowerShell:

```powershell
Invoke-WebRequest http://localhost:5005/ -UseBasicParsing | Select-Object -ExpandProperty Content
```

Git Bash / curl:

```bash
curl.exe http://localhost:5005/
```

Expected output: JSON with `"configured": true` and `"ready": true`.

### Synthesise speech directly

PowerShell:

```powershell
Invoke-RestMethod -Uri "http://localhost:5005/speak" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"text":"Hello Jimmy."}' `
  -OutFile "test.wav"
```

Git Bash / curl:

```bash
curl.exe -X POST http://localhost:5005/speak \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"Hello Jimmy.\"}" \
  --output test.wav
```

Open `test.wav` — you should hear Piper speak.

### Test through Jarvis UI

1. Open http://localhost:3000
2. In the voice bar, select **TTS: Local TTS**
3. Click **Test voice** — you should hear Piper speak through the browser
4. Enable **Voice replies** and send a message — the response should be spoken

---

## K. Cleanup and switching back to browser TTS

When you are done using local TTS:

1. Stop the Piper wrapper server (Ctrl+C in its terminal).
2. In `apps/api/.env`, set:
   ```env
   LOCAL_TTS_ENABLED=false
   ```
   Or delete the file — defaults are safe.
3. Restart the Jarvis API.
4. In the Jarvis UI, switch back to **TTS: Browser voice**.

**Never commit:**
- `local-tts/`
- `*.onnx`, `*.onnx.json`
- `*.wav`, `*.mp3`
- `apps/api/.env`

All of the above are covered by `.gitignore`.
Run `git status` to confirm nothing is staged before any commit.

---

## Quick reference

| Task | Command |
|---|---|
| Run setup script | `powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1` |
| Start Piper wrapper | Set `$env:PIPER_BIN` + `$env:PIPER_VOICE_MODEL`, then `npm run dev:tts-piper` |
| Start mock TTS (no Piper needed) | `npm run dev:tts-mock` |
| Check wrapper status | `curl.exe http://localhost:5005/` |
| Full Jarvis stack | `npm run dev` |
| Disable local TTS | Set `LOCAL_TTS_ENABLED=false` in `apps/api/.env` |

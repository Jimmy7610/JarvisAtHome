# Jarvis — Piper TTS environment setup example (PowerShell)
#
# This file is DOCUMENTATION, not a runnable script.
# Copy the commands you need into your terminal session.
#
# Run these in the same PowerShell session BEFORE starting the Piper wrapper.
# Environment variables set with $env: are session-scoped — they are not
# saved between terminal sessions.  Re-run these commands each time you
# open a new terminal.
#
# After running setup-piper-windows.ps1 the exact paths will be printed
# for you.  Paste them here and replace the placeholders below.
#
# ─── Set Piper paths ──────────────────────────────────────────────────────────

# Required: path to the Piper binary.
$env:PIPER_BIN = "C:\Users\Jimmy\Documents\GitHub\Jarvis\local-tts\piper\piper.exe"

# Required: path to the .onnx voice model file.
$env:PIPER_VOICE_MODEL = "C:\Users\Jimmy\Documents\GitHub\Jarvis\local-tts\voices\en_GB-alan-medium.onnx"

# Optional: path to the .onnx.json config file.
# Piper auto-detects it when it sits next to the .onnx file with the same base name.
$env:PIPER_VOICE_CONFIG = "C:\Users\Jimmy\Documents\GitHub\Jarvis\local-tts\voices\en_GB-alan-medium.onnx.json"

# ─── Optional tuning ──────────────────────────────────────────────────────────

# Port to listen on (default: 5005)
# $env:PIPER_SERVER_PORT = "5005"

# Voice variation (float, e.g. 0.667 — lower = more consistent)
# $env:PIPER_NOISE_SCALE = "0.667"

# Speech rate (float, 1.0 = normal, 1.2 = 20% faster)
# $env:PIPER_LENGTH_SCALE = "1.0"

# Phoneme width variation (float)
# $env:PIPER_NOISE_W = "0.8"

# ─── Start the Piper wrapper ──────────────────────────────────────────────────

npm run dev:tts-piper

# ─── apps/api/.env settings (separate file, not PowerShell) ──────────────────
#
# Create apps/api/.env and add:
#
#   LOCAL_TTS_ENABLED=true
#   LOCAL_TTS_BASE_URL=http://localhost:5005
#   LOCAL_TTS_PROVIDER=piper
#
# Restart the Jarvis API after changing .env:
#   npm run dev:api
#
# ─── Quick smoke test (in a second terminal) ──────────────────────────────────
#
# PowerShell:
#   Invoke-WebRequest http://localhost:5005/ | Select-Object -ExpandProperty Content
#
# Git Bash / curl:
#   curl http://localhost:5005/
#   curl -X POST http://localhost:5005/speak -H "Content-Type: application/json" \
#     -d "{\"text\": \"Hello Jimmy.\"}" --output test.wav

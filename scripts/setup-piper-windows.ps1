#Requires -Version 5.1
<#
.SYNOPSIS
    Jarvis v0.5.9 - optional Piper TTS setup helper for Windows.

.DESCRIPTION
    Downloads the Piper TTS binary and one English voice model into the
    gitignored local-tts/ directory inside the Jarvis repo.

    This script does NOT run automatically.
    You must run it explicitly from the repo root:

        powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1

    Use -DryRun to preview what will be downloaded without downloading:

        powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1 -DryRun

    After the script completes, it prints the exact PowerShell commands
    you need to start the Piper wrapper server and the .env settings for
    the Jarvis API.

.PARAMETER DryRun
    Print URLs and target paths without downloading anything.
    Useful to verify configuration before committing to a download.

.NOTES
    DO NOT COMMIT:
      local-tts/           - Piper binary, DLLs, espeak-ng-data
      *.onnx / *.onnx.json - voice model files
      *.wav / *.mp3        - generated audio
      apps/api/.env        - environment config with secrets

    These are all covered by .gitignore.

    See: docs\setup\piper-windows-checklist.md
#>

param(
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- URLs --------------------------------------------------------------------
#
# Piper binary
#   Source  : https://github.com/rhasspy/piper/releases/tag/2023.11.14-2
#   Release : 2023.11.14-2  (latest as of 2026-04-29, repo archived Oct 2025)
#   Asset   : piper_windows_amd64.zip  (approx 21 MB)
#   Verified: HEAD request returned HTTP 200 on 2026-04-29
#
$PiperZipUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"

# Voice model: en_GB-alan-medium
#   Source  : https://huggingface.co/rhasspy/piper-voices
#   Voice   : en_GB-alan-medium  (British English male, medium quality)
#   Reason  : British English, calm and clear, good for an assistant,
#             not intended to imitate any fictional character.
#             Medium quality balances file size (~60 MB) and output quality.
#   Verified: HEAD request returned HTTP 200 on 2026-04-29
#
$VoiceModelUrl  = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx"
$VoiceConfigUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json"

# File names derived from the voice selection above.
$PiperZipName    = "piper_windows_amd64.zip"
$VoiceModelName  = "en_GB-alan-medium.onnx"
$VoiceConfigName = "en_GB-alan-medium.onnx.json"

# --- Repo root ---------------------------------------------------------------

# Resolve the repo root relative to this script's location.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

# --- Paths -------------------------------------------------------------------

$LocalTtsDir  = Join-Path $RepoRoot "local-tts"
$PiperDir     = Join-Path $LocalTtsDir "piper"
$VoicesDir    = Join-Path $LocalTtsDir "voices"
$PiperZipPath = Join-Path $PiperDir $PiperZipName
$VoiceOnnx    = Join-Path $VoicesDir $VoiceModelName
$VoiceJson    = Join-Path $VoicesDir $VoiceConfigName

# --- Banner ------------------------------------------------------------------

Write-Host ""
if ($DryRun) {
    Write-Host "=================================================================" -ForegroundColor Magenta
    Write-Host "  Jarvis v0.5.9 - Piper TTS Windows Setup Helper (DRY RUN)" -ForegroundColor Magenta
    Write-Host "  No files will be downloaded or created." -ForegroundColor Magenta
    Write-Host "=================================================================" -ForegroundColor Magenta
} else {
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "  Jarvis v0.5.9 - Piper TTS Windows Setup Helper" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
}
Write-Host "  Repo root : $RepoRoot"
Write-Host "  Piper dir : $PiperDir"
Write-Host "  Voices dir: $VoicesDir"
Write-Host ""

# --- Validate URLs -----------------------------------------------------------

$placeholder = "<TO_BE_FILLED"
$urlsOk = $true

if ($PiperZipUrl    -like "*$placeholder*") { $urlsOk = $false; Write-Warning "`$PiperZipUrl    is still a placeholder." }
if ($VoiceModelUrl  -like "*$placeholder*") { $urlsOk = $false; Write-Warning "`$VoiceModelUrl  is still a placeholder." }
if ($VoiceConfigUrl -like "*$placeholder*") { $urlsOk = $false; Write-Warning "`$VoiceConfigUrl is still a placeholder." }

if (-not $urlsOk) {
    Write-Host ""
    Write-Host "ACTION REQUIRED - URLs are not filled in yet." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Step 1: Read the setup checklist:" -ForegroundColor White
    Write-Host "    docs\setup\piper-windows-checklist.md" -ForegroundColor Cyan
    Write-Host "    Sections F and G explain exactly where to find each URL." -ForegroundColor White
    Write-Host ""
    Write-Host "  Step 2: Open this script in a text editor:" -ForegroundColor White
    Write-Host "    scripts\setup-piper-windows.ps1" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Step 3: Fill in the three URL variables near the top." -ForegroundColor White
    Write-Host ""
    Write-Host "  Step 4: Run this script again." -ForegroundColor White
    Write-Host ""
    exit 1
}

# --- Dry-run mode ------------------------------------------------------------

if ($DryRun) {
    Write-Host "URLs are filled in and valid." -ForegroundColor Green
    Write-Host ""
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta
    Write-Host "  Piper binary" -ForegroundColor Magenta
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta
    Write-Host "  URL  : $PiperZipUrl"
    Write-Host "  Size : approx 21 MB"
    Write-Host "  Dest : $PiperZipPath"
    Write-Host ""
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta
    Write-Host "  Voice model" -ForegroundColor Magenta
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta
    Write-Host "  Voice: en_GB-alan-medium (British English male, medium quality)"
    Write-Host "  URL  : $VoiceModelUrl"
    Write-Host "  Size : approx 60 MB"
    Write-Host "  Dest : $VoiceOnnx"
    Write-Host ""
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta
    Write-Host "  Voice config" -ForegroundColor Magenta
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta
    Write-Host "  URL  : $VoiceConfigUrl"
    Write-Host "  Dest : $VoiceJson"
    Write-Host ""
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta
    Write-Host "  Dry run complete - nothing was downloaded." -ForegroundColor Magenta
    Write-Host "  To run the real setup:" -ForegroundColor White
    Write-Host "    powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1" -ForegroundColor Yellow
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta
    Write-Host ""
    exit 0
}

# --- Create directories ------------------------------------------------------

foreach ($dir in @($PiperDir, $VoicesDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "Created: $dir" -ForegroundColor Green
    } else {
        Write-Host "Exists : $dir"
    }
}

# --- Download Piper zip ------------------------------------------------------

if (Test-Path $PiperZipPath) {
    Write-Host "Piper zip already present - skipping download: $PiperZipPath"
} else {
    Write-Host ""
    Write-Host "Downloading Piper binary (approx 21 MB)..." -ForegroundColor Cyan
    Write-Host "  From: $PiperZipUrl"
    Write-Host "  To  : $PiperZipPath"
    Invoke-WebRequest -Uri $PiperZipUrl -OutFile $PiperZipPath -UseBasicParsing
    Write-Host "Downloaded." -ForegroundColor Green
}

# --- Extract Piper zip -------------------------------------------------------

$PiperExe = Get-ChildItem -Path $PiperDir -Filter "piper.exe" -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1

if ($null -ne $PiperExe) {
    Write-Host "piper.exe already extracted - skipping: $($PiperExe.FullName)"
} else {
    Write-Host ""
    Write-Host "Extracting $PiperZipName into $PiperDir ..." -ForegroundColor Cyan
    Expand-Archive -Path $PiperZipPath -DestinationPath $PiperDir -Force
    Write-Host "Extracted." -ForegroundColor Green

    $PiperExe = Get-ChildItem -Path $PiperDir -Filter "piper.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($null -eq $PiperExe) {
        Write-Error "piper.exe not found in $PiperDir after extraction. Check the zip contents."
        exit 1
    }
}

$PiperExePath = $PiperExe.FullName

# --- Download voice model ----------------------------------------------------

if (Test-Path $VoiceOnnx) {
    Write-Host "Voice .onnx already present - skipping: $VoiceOnnx"
} else {
    Write-Host ""
    Write-Host "Downloading voice model: en_GB-alan-medium (approx 60 MB)..." -ForegroundColor Cyan
    Write-Host "  From: $VoiceModelUrl"
    Write-Host "  To  : $VoiceOnnx"
    Invoke-WebRequest -Uri $VoiceModelUrl -OutFile $VoiceOnnx -UseBasicParsing
    Write-Host "Downloaded." -ForegroundColor Green
}

# --- Download voice config ---------------------------------------------------

if (Test-Path $VoiceJson) {
    Write-Host "Voice .onnx.json already present - skipping: $VoiceJson"
} else {
    Write-Host ""
    Write-Host "Downloading voice config..." -ForegroundColor Cyan
    Write-Host "  From: $VoiceConfigUrl"
    Write-Host "  To  : $VoiceJson"
    Invoke-WebRequest -Uri $VoiceConfigUrl -OutFile $VoiceJson -UseBasicParsing
    Write-Host "Downloaded." -ForegroundColor Green
}

# --- Summary -----------------------------------------------------------------

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "  Setup complete." -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  piper.exe   : $PiperExePath"
Write-Host "  Voice model : $VoiceOnnx"
Write-Host "  Voice config: $VoiceJson"
Write-Host ""

# --- Next steps --------------------------------------------------------------

Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  STEP 1 - Start the Piper wrapper server" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Run in a new PowerShell terminal:" -ForegroundColor White
Write-Host ""
Write-Host "    `$env:PIPER_BIN=`"$PiperExePath`"" -ForegroundColor Yellow
Write-Host "    `$env:PIPER_VOICE_MODEL=`"$VoiceOnnx`"" -ForegroundColor Yellow
Write-Host "    `$env:PIPER_VOICE_CONFIG=`"$VoiceJson`"" -ForegroundColor Yellow
Write-Host "    npm run dev:tts-piper" -ForegroundColor Yellow
Write-Host ""
Write-Host "  The Piper wrapper will start at http://127.0.0.1:5005"
Write-Host ""

Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  STEP 2 - Configure the Jarvis API" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Add to apps\api\.env (create the file if it does not exist):" -ForegroundColor White
Write-Host ""
Write-Host "    LOCAL_TTS_ENABLED=true" -ForegroundColor Yellow
Write-Host "    LOCAL_TTS_BASE_URL=http://localhost:5005" -ForegroundColor Yellow
Write-Host "    LOCAL_TTS_PROVIDER=piper" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Then restart the Jarvis API:" -ForegroundColor White
Write-Host ""
Write-Host "    npm run dev:api" -ForegroundColor Yellow
Write-Host ""

Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  STEP 3 - Test in the UI" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Open http://localhost:3000"
Write-Host "  2. Select TTS: Local TTS in the voice bar"
Write-Host "  3. Click Test voice - you should hear Piper speak"
Write-Host "  4. Enable Voice replies and send a message"
Write-Host ""

Write-Host "-----------------------------------------------------------------" -ForegroundColor Red
Write-Host "  SAFETY REMINDERS - DO NOT COMMIT" -ForegroundColor Red
Write-Host "-----------------------------------------------------------------" -ForegroundColor Red
Write-Host ""
Write-Host "  local-tts\       - Piper binary, DLLs, espeak-ng-data\, voices\"
Write-Host "  *.onnx           - voice model files"
Write-Host "  *.onnx.json      - voice config files"
Write-Host "  *.wav / *.mp3    - generated audio"
Write-Host "  apps\api\.env    - local environment config"
Write-Host ""
Write-Host "  All of the above are covered by .gitignore."
Write-Host "  Run 'git status' to confirm nothing is staged."
Write-Host ""

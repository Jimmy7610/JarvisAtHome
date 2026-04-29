#Requires -Version 5.1
<#
.SYNOPSIS
    Jarvis v0.5.8 - optional Piper TTS setup helper for Windows.

.DESCRIPTION
    Downloads the Piper TTS binary and one English voice model into the
    gitignored local-tts/ directory inside the Jarvis repo.

    This script does NOT run automatically.
    You must run it explicitly from the repo root:

        powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1

    After the script completes, it prints the exact PowerShell commands
    you need to start the Piper wrapper server and the .env settings for
    the Jarvis API.

.NOTES
    IMPORTANT - FILL IN THE URLS BEFORE RUNNING
    ---------------------------------------------
    The $PiperZipUrl, $VoiceModelUrl, and $VoiceConfigUrl variables below
    contain placeholder values.  The script will refuse to download anything
    until you replace them with the correct official URLs.

    Where to find official URLs:
      Piper binary  : https://github.com/rhasspy/piper/releases
                      Download the "piper_windows_amd64.zip" asset from
                      the latest release.
      Voice model   : https://huggingface.co/rhasspy/piper-voices
                      Navigate to the voice folder (e.g. en/en_GB/alan/medium/)
                      and copy the download URL for the .onnx and .onnx.json files.

    Example URL patterns (versions change - verify on the release pages):
      Piper zip  : https://github.com/rhasspy/piper/releases/download/<tag>/piper_windows_amd64.zip
      Voice .onnx: https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx
      Voice .json: https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json

    DO NOT COMMIT:
      local-tts/           - Piper binary, DLLs, espeak-ng-data
      *.onnx / *.onnx.json - voice model files
      *.wav / *.mp3        - generated audio
      apps/api/.env        - environment config with secrets

    These are all covered by .gitignore.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- URLs - FILL THESE IN BEFORE RUNNING ------------------------------------
# Replace each placeholder with the actual official URL.
# The script will stop immediately if any placeholder is still present.

$PiperZipUrl    = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_RELEASE>"
$VoiceModelUrl  = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_VOICE>"
$VoiceConfigUrl = "<TO_BE_FILLED_FROM_OFFICIAL_PIPER_VOICE_CONFIG>"

# File names for the downloaded artifacts.
$PiperZipName    = "piper_windows_amd64.zip"
$VoiceModelName  = "en_GB-alan-medium.onnx"
$VoiceConfigName = "en_GB-alan-medium.onnx.json"

# --- Repo root ---------------------------------------------------------------

# Resolve the repo root relative to this script's location.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

# --- Paths -------------------------------------------------------------------

$LocalTtsDir   = Join-Path $RepoRoot "local-tts"
$PiperDir      = Join-Path $LocalTtsDir "piper"
$VoicesDir     = Join-Path $LocalTtsDir "voices"
$PiperZipPath  = Join-Path $PiperDir $PiperZipName
$VoiceOnnx     = Join-Path $VoicesDir $VoiceModelName
$VoiceJson     = Join-Path $VoicesDir $VoiceConfigName

# --- Banner ------------------------------------------------------------------

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Jarvis v0.5.8 - Piper TTS Windows Setup Helper" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
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
    Write-Host "  Step 3: Fill in the three URL variables near line 55:" -ForegroundColor White
    Write-Host ""
    Write-Host "    `$PiperZipUrl    - piper_windows_amd64.zip download URL" -ForegroundColor Yellow
    Write-Host "                      from https://github.com/rhasspy/piper/releases" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    `$VoiceModelUrl  - voice .onnx download URL" -ForegroundColor Yellow
    Write-Host "    `$VoiceConfigUrl - voice .onnx.json download URL" -ForegroundColor Yellow
    Write-Host "                      from https://huggingface.co/rhasspy/piper-voices" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Step 4: Run this script again." -ForegroundColor White
    Write-Host ""
    exit 1
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
    Write-Host "Downloading Piper binary..." -ForegroundColor Cyan
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
    Write-Host "Downloading voice model (.onnx)..." -ForegroundColor Cyan
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
    Write-Host "Downloading voice config (.onnx.json)..." -ForegroundColor Cyan
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

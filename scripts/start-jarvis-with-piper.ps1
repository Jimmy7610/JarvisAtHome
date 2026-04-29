#Requires -Version 5.1
<#
.SYNOPSIS
    Jarvis v0.5.10 - Quick launcher for Jarvis dev + Piper TTS.

.DESCRIPTION
    Opens two PowerShell windows:
      1. Piper TTS wrapper  (npm run dev:tts-piper)
      2. Jarvis dev stack   (npm run dev)

    Checks that Piper is installed in local-tts/ before starting.
    Checks whether port 5005 is already in use.
    Does not download, install, or configure anything.

    Prerequisites:
      - Run scripts\setup-piper-windows.ps1 first (downloads Piper)
      - Create apps\api\.env with LOCAL_TTS_ENABLED=true
      - See docs\setup\piper-windows-checklist.md

    Usage:
      powershell -ExecutionPolicy Bypass -File .\scripts\start-jarvis-with-piper.ps1

    Optional flags:
      -SkipPiper   Do not open the Piper TTS wrapper window
      -SkipJarvis  Do not open the Jarvis dev stack window

    Both flags together do nothing but print the summary.
    Useful for testing the prerequisite checks without starting windows.

.PARAMETER SkipPiper
    Skip starting the Piper TTS wrapper window.

.PARAMETER SkipJarvis
    Skip starting the Jarvis dev stack window.

.NOTES
    DO NOT COMMIT:
      local-tts\       - Piper binary and voice model files (gitignored)
      apps\api\.env    - local environment config (gitignored)
#>

param(
    [switch]$SkipPiper,
    [switch]$SkipJarvis
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Repo root ---------------------------------------------------------------

# Resolve repo root from this script's location (scripts/ is one level down)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

# --- Expected Piper paths ----------------------------------------------------
# The setup script extracts piper_windows_amd64.zip into local-tts\piper\
# which creates a local-tts\piper\piper\ subfolder containing piper.exe.

$PiperExe  = Join-Path $RepoRoot "local-tts\piper\piper\piper.exe"
$VoiceOnnx = Join-Path $RepoRoot "local-tts\voices\en_GB-alan-medium.onnx"
$VoiceJson = Join-Path $RepoRoot "local-tts\voices\en_GB-alan-medium.onnx.json"
$EnvFile   = Join-Path $RepoRoot "apps\api\.env"

# Internal flags (may be overridden by port check)
$startPiper  = -not $SkipPiper.IsPresent
$startJarvis = -not $SkipJarvis.IsPresent

# --- Banner ------------------------------------------------------------------

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Jarvis v0.5.10 - Quick Launcher" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Repo root : $RepoRoot"
Write-Host ""

# --- Piper prerequisite check ------------------------------------------------

if ($startPiper) {
    $missing = [System.Collections.ArrayList]@()
    if (-not (Test-Path $PiperExe))  { $null = $missing.Add($PiperExe)  }
    if (-not (Test-Path $VoiceOnnx)) { $null = $missing.Add($VoiceOnnx) }
    if (-not (Test-Path $VoiceJson)) { $null = $missing.Add($VoiceJson) }

    if ($missing.Count -gt 0) {
        Write-Host "ERROR: Required Piper files are missing." -ForegroundColor Red
        Write-Host ""
        foreach ($f in $missing) {
            Write-Host "  Missing: $f" -ForegroundColor Red
        }
        Write-Host ""
        Write-Host "  Run the Piper setup script first:" -ForegroundColor Yellow
        Write-Host "    powershell -ExecutionPolicy Bypass -File .\scripts\setup-piper-windows.ps1" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Full instructions:" -ForegroundColor Yellow
        Write-Host "    docs\setup\piper-windows-checklist.md" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }

    Write-Host "Piper files found:" -ForegroundColor Green
    Write-Host "  $PiperExe"
    Write-Host "  $VoiceOnnx"
    Write-Host "  $VoiceJson"
    Write-Host ""
}

# --- Port 5005 check ---------------------------------------------------------

if ($startPiper) {
    $port5005 = Get-NetTCPConnection -LocalPort 5005 -State Listen -ErrorAction SilentlyContinue
    if ($null -ne $port5005) {
        Write-Host "Port 5005 is already listening." -ForegroundColor Yellow
        Write-Host "  A Piper wrapper or other server is already running on port 5005." -ForegroundColor Yellow
        Write-Host "  Skipping Piper window - Jarvis will still connect to the existing server." -ForegroundColor Yellow
        Write-Host ""
        $startPiper = $false
    }
}

# --- .env reminder -----------------------------------------------------------

if (-not (Test-Path $EnvFile)) {
    Write-Host "NOTE: apps\api\.env was not found." -ForegroundColor Yellow
    Write-Host "  Local TTS will not work until you create it with:" -ForegroundColor Yellow
    Write-Host "    LOCAL_TTS_ENABLED=true" -ForegroundColor Yellow
    Write-Host "    LOCAL_TTS_BASE_URL=http://localhost:5005" -ForegroundColor Yellow
    Write-Host "    LOCAL_TTS_PROVIDER=piper" -ForegroundColor Yellow
    Write-Host "  Do not commit apps\api\.env to Git." -ForegroundColor Yellow
    Write-Host ""
} else {
    $envContent = Get-Content $EnvFile -Raw -ErrorAction SilentlyContinue
    if ($envContent -notmatch "LOCAL_TTS_ENABLED\s*=\s*true") {
        Write-Host "NOTE: LOCAL_TTS_ENABLED=true not found in apps\api\.env." -ForegroundColor Yellow
        Write-Host "  Add it so Jarvis can forward speech to the Piper wrapper." -ForegroundColor Yellow
        Write-Host ""
    }
}

# --- Start Piper window ------------------------------------------------------

if ($startPiper) {
    # Build the command string for the new PowerShell window.
    # Path values use single-quoted strings to handle spaces safely.
    # $env: variables are set as plain string assignments (no quotes needed for the value).
    $piperCmd = "`$env:PIPER_BIN='$PiperExe'; " +
                "`$env:PIPER_VOICE_MODEL='$VoiceOnnx'; " +
                "`$env:PIPER_VOICE_CONFIG='$VoiceJson'; " +
                "Set-Location '$RepoRoot'; " +
                "Write-Host 'Piper TTS wrapper starting on http://127.0.0.1:5005 ...'; " +
                "npm run dev:tts-piper"

    Start-Process powershell -ArgumentList "-NoExit -Command `"$piperCmd`"" -WindowStyle Normal
    Write-Host "Started: Piper TTS wrapper window" -ForegroundColor Green
    Write-Host "  Wrapper will be ready at: http://127.0.0.1:5005"
    Write-Host "  Voice: en_GB-alan-medium (British English)"
    Write-Host ""
}

# --- Start Jarvis window -----------------------------------------------------

if ($startJarvis) {
    $jarvisCmd = "Set-Location '$RepoRoot'; " +
                 "Write-Host 'Starting Jarvis dev stack (frontend + API)...'; " +
                 "npm run dev"

    Start-Process powershell -ArgumentList "-NoExit -Command `"$jarvisCmd`"" -WindowStyle Normal
    Write-Host "Started: Jarvis dev stack window" -ForegroundColor Green
    Write-Host "  Frontend: http://localhost:3000"
    Write-Host "  API:      http://localhost:4000"
    Write-Host ""
}

# --- Summary -----------------------------------------------------------------

Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  Next steps" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Wait a few seconds for both servers to start."
Write-Host "  2. Open http://localhost:3000 in your browser."
Write-Host "  3. In the voice bar, select: TTS: Local TTS"
Write-Host "  4. Click Test voice - you should hear Piper speak."
Write-Host "  5. Enable Voice replies to hear all responses."
Write-Host ""
Write-Host "  To stop: close both PowerShell windows (or press Ctrl+C in each)."
Write-Host ""

Write-Host "-----------------------------------------------------------------" -ForegroundColor Red
Write-Host "  Safety reminders" -ForegroundColor Red
Write-Host "-----------------------------------------------------------------" -ForegroundColor Red
Write-Host ""
Write-Host "  Do not commit local-tts\  (Piper binary + voice models)"
Write-Host "  Do not commit apps\api\.env  (local environment config)"
Write-Host "  Run 'git status' to confirm nothing sensitive is staged."
Write-Host ""

#!/usr/bin/env node
/**
 * Jarvis local TTS — Piper HTTP wrapper server.
 *
 * Exposes POST /speak (the Jarvis local TTS contract) and fulfils it by
 * running a locally installed Piper binary on each request.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. Receives POST /speak with JSON { text, lang, voice }.
 * 2. Spawns the Piper binary (PIPER_BIN) with:
 *      --model <PIPER_VOICE_MODEL>
 *      --output_file <OS-temp-dir>/jarvis-piper-<id>.wav
 * 3. Writes text to Piper's stdin and closes it.
 * 4. Waits for Piper to exit (30 s hard timeout).
 * 5. Reads the temporary WAV file, deletes it, and returns audio/wav.
 *
 * WHY TEMP FILE (not stdout)?
 * ───────────────────────────
 * Piper's --output_file flag writes a proper RIFF/WAV file.
 * The --output-raw flag writes raw PCM with no header, requiring a separate
 * WAV-wrapping step that varies by voice model sample rate.  The temp-file
 * approach is more reliable across Piper versions and Windows/Linux/macOS.
 *
 * SETUP (before running this script)
 * ────────────────────────────────────
 * 1. Download the Piper release for your platform from:
 *    https://github.com/rhasspy/piper/releases
 *
 * 2. Download a voice model (.onnx + .onnx.json) from:
 *    https://huggingface.co/rhasspy/piper-voices
 *    Swedish: sv_SE-nst-medium.onnx
 *    English: en_GB-alan-medium.onnx  or  en_US-lessac-medium.onnx
 *
 * 3. Store Piper and models somewhere OUTSIDE the repo, or inside
 *    local-tts/ (which is gitignored):
 *    Jarvis/local-tts/piper/piper.exe
 *    Jarvis/local-tts/voices/en_GB-alan-medium.onnx
 *    Jarvis/local-tts/voices/en_GB-alan-medium.onnx.json
 *
 * 4. Set environment variables, then start the server:
 *
 *    PowerShell:
 *      $env:PIPER_BIN="C:\path\to\piper.exe"
 *      $env:PIPER_VOICE_MODEL="C:\path\to\voice.onnx"
 *      npm run dev:tts-piper
 *
 *    Bash:
 *      PIPER_BIN=/path/to/piper PIPER_VOICE_MODEL=/path/to/voice.onnx npm run dev:tts-piper
 *
 * 5. In apps/api/.env:
 *      LOCAL_TTS_ENABLED=true
 *      LOCAL_TTS_BASE_URL=http://localhost:5005
 *      LOCAL_TTS_PROVIDER=piper
 *
 * 6. Restart the Jarvis API, select "Local TTS" in the UI, click "Test voice".
 *
 * ENVIRONMENT VARIABLES
 * ──────────────────────
 * PIPER_BIN              Path to the piper (or piper.exe) binary. REQUIRED.
 * PIPER_VOICE_MODEL      Path to the .onnx voice model file. REQUIRED.
 * PIPER_VOICE_CONFIG     Path to the .onnx.json config file. Optional —
 *                        Piper auto-detects it if it sits next to the .onnx file
 *                        with the same base name.
 * PIPER_SERVER_PORT      Port to listen on. Default: 5005.
 * PIPER_NOISE_SCALE      Voice variation (float, e.g. 0.667). Optional.
 * PIPER_LENGTH_SCALE     Speech rate (float, e.g. 1.0 = normal). Optional.
 * PIPER_NOISE_W          Phoneme width variation (float). Optional.
 *
 * ⚠  DO NOT commit Piper binaries, .onnx model files, or generated audio.
 *    DO NOT use this in production — it is an optional local development tool.
 *
 * Requires: Node.js ≥ 20.  No npm packages beyond Node.js built-ins.
 */

import { createServer }         from "node:http";
import { spawn }                from "node:child_process";
import { readFile, unlink }     from "node:fs/promises";
import { join }                 from "node:path";
import { tmpdir }               from "node:os";
import { randomBytes }          from "node:crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT              = parseInt(process.env.PIPER_SERVER_PORT ?? "5005", 10);
const BIND              = "127.0.0.1"; // localhost-only — never bind to 0.0.0.0
const PIPER_BIN         = (process.env.PIPER_BIN         ?? "").trim();
const PIPER_VOICE_MODEL = (process.env.PIPER_VOICE_MODEL ?? "").trim();
const PIPER_VOICE_CONFIG= (process.env.PIPER_VOICE_CONFIG ?? "").trim();
const PIPER_NOISE_SCALE = (process.env.PIPER_NOISE_SCALE ?? "").trim();
const PIPER_LENGTH_SCALE= (process.env.PIPER_LENGTH_SCALE ?? "").trim();
const PIPER_NOISE_W     = (process.env.PIPER_NOISE_W     ?? "").trim();

const MAX_TEXT_LEN    = 4000;
const PIPER_TIMEOUT   = 30_000; // ms

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isConfigured() {
  return PIPER_BIN !== "" && PIPER_VOICE_MODEL !== "";
}

/**
 * Normalise text for Piper: collapse whitespace and newlines into single spaces
 * so Piper receives one utterance rather than many lines.
 *
 * @param {string} text
 * @returns {string}
 */
function normaliseText(text) {
  return text.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Run Piper and return a Buffer containing a valid WAV file.
 *
 * Strategy: use --output_file with a unique temp path in the OS temp directory.
 * This is the most portable approach across Piper versions and platforms.
 * The temp file is always deleted after the response, even on error.
 *
 * @param {string} text  — already validated and normalised
 * @returns {Promise<Buffer>}
 */
async function runPiper(text) {
  const tmpId  = randomBytes(8).toString("hex");
  const tmpWav = join(tmpdir(), `jarvis-piper-${tmpId}.wav`);

  // Build Piper argument list
  const args = ["--model", PIPER_VOICE_MODEL, "--output_file", tmpWav];
  if (PIPER_VOICE_CONFIG)  args.push("--config",       PIPER_VOICE_CONFIG);
  if (PIPER_NOISE_SCALE)   args.push("--noise-scale",  PIPER_NOISE_SCALE);
  if (PIPER_LENGTH_SCALE)  args.push("--length-scale", PIPER_LENGTH_SCALE);
  if (PIPER_NOISE_W)       args.push("--noise-w",      PIPER_NOISE_W);

  return new Promise((resolve, reject) => {
    let timedOut = false;
    let stderr   = "";

    const piper = spawn(PIPER_BIN, args, {
      // stdin: pipe (we write text)
      // stdout: pipe (Piper may write progress there — we ignore it)
      // stderr: pipe (captured for error messages)
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Hard timeout — kill Piper if it hangs
    const timeoutId = setTimeout(() => {
      timedOut = true;
      piper.kill("SIGKILL");
      unlink(tmpWav).catch(() => {});
      reject(new Error(
        `Piper timed out after ${PIPER_TIMEOUT / 1000} seconds. ` +
        "Check that the model path is correct and the binary is not corrupted."
      ));
    }, PIPER_TIMEOUT);

    // Collect stderr for diagnostics (capped — never log full body)
    piper.stderr.on("data", (chunk) => {
      if (stderr.length < 500) stderr += chunk.toString();
    });

    // Suppress broken-pipe errors if Piper exits before we finish writing
    piper.stdin.on("error", () => {});

    // Write the text to Piper stdin and close the stream
    try {
      // A trailing newline signals end-of-utterance to Piper
      piper.stdin.write(text + "\n");
      piper.stdin.end();
    } catch {
      // If stdin is already closed (early Piper exit), let the 'close' handler deal with it
    }

    piper.on("error", (err) => {
      clearTimeout(timeoutId);
      unlink(tmpWav).catch(() => {});
      reject(new Error(
        `Failed to start Piper binary: ${err.message}. ` +
        "Is PIPER_BIN pointing to a valid executable?"
      ));
    });

    piper.on("close", async (code) => {
      clearTimeout(timeoutId);
      if (timedOut) return; // already rejected via timeout handler

      if (code !== 0) {
        unlink(tmpWav).catch(() => {});
        const hint = stderr.trim().slice(0, 300);
        reject(new Error(
          `Piper exited with code ${code}.` +
          (hint ? ` stderr: ${hint}` : " No stderr output.")
        ));
        return;
      }

      // Piper finished successfully — read the WAV file
      try {
        const wavData = await readFile(tmpWav);
        resolve(wavData);
      } catch {
        reject(new Error(
          `Piper reported success but the WAV file was not created: ${tmpWav}. ` +
          "This can happen if the model path is wrong or the voice config is missing."
        ));
      } finally {
        // Always clean up — ignore errors (file may already be gone)
        unlink(tmpWav).catch(() => {});
      }
    });
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer((req, res) => {

  // ── GET / — status page ───────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/") {
    const status = {
      ok:         true,
      provider:   "piper",
      configured: isConfigured(),
      piperBin:   PIPER_BIN   || "(not set — PIPER_BIN required)",
      voiceModel: PIPER_VOICE_MODEL || "(not set — PIPER_VOICE_MODEL required)",
      port:       PORT,
      ready:      isConfigured(),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status, null, 2) + "\n");
    return;
  }

  // ── POST /speak — synthesise speech ──────────────────────────────────────
  if (req.method === "POST" && req.url === "/speak") {
    let rawBody = "";

    req.on("data", (chunk) => { rawBody += chunk; });

    req.on("end", async () => {

      // Parse body — non-JSON bodies are handled gracefully
      let parsed = {};
      try { parsed = JSON.parse(rawBody); } catch { /* keep empty obj */ }

      const text  = typeof parsed.text  === "string" ? parsed.text.trim()  : "";
      const lang  = typeof parsed.lang  === "string" ? parsed.lang  : "—";
      const voice = typeof parsed.voice === "string" ? parsed.voice : "—";

      // ── Input validation ─────────────────────────────────────────────────

      if (!text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "text must be a non-empty string." }));
        return;
      }
      if (text.length > MAX_TEXT_LEN) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok:    false,
          error: `text exceeds the maximum length of ${MAX_TEXT_LEN} characters.`,
        }));
        return;
      }

      // ── Config check ─────────────────────────────────────────────────────

      if (!isConfigured()) {
        const missing = [
          ...(!PIPER_BIN         ? ["PIPER_BIN"]         : []),
          ...(!PIPER_VOICE_MODEL ? ["PIPER_VOICE_MODEL"] : []),
        ];
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok:    false,
          error: `Piper is not configured. Set the following environment variables ` +
                 `before starting this server: ${missing.join(", ")}. ` +
                 `See docs/setup/local-tts-server.md for instructions.`,
        }));
        return;
      }

      // ── Run Piper ────────────────────────────────────────────────────────

      // Normalise to a single line before passing to Piper
      const normText = normaliseText(text);

      // Log a safe short preview — never log full body
      const preview = normText.length > 80
        ? normText.slice(0, 80) + "…"
        : normText;
      console.log(`[piper] POST /speak  lang="${lang}"  voice="${voice}"  text="${preview}"`);

      try {
        const wav = await runPiper(normText);
        console.log(`[piper] WAV ready — ${wav.length} bytes`);
        res.writeHead(200, {
          "Content-Type":   "audio/wav",
          "Content-Length": String(wav.length),
        });
        res.end(wav);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown Piper error.";
        console.error(`[piper] Error: ${errMsg}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: errMsg }));
      }
    });

    req.on("error", () => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Bad request." }));
    });

    return;
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found." }));
});

server.listen(PORT, BIND, () => {
  console.log(`[piper] Jarvis Piper TTS wrapper at http://${BIND}:${PORT}`);
  if (isConfigured()) {
    console.log(`[piper] PIPER_BIN:         ${PIPER_BIN}`);
    console.log(`[piper] PIPER_VOICE_MODEL: ${PIPER_VOICE_MODEL}`);
    if (PIPER_VOICE_CONFIG)
      console.log(`[piper] PIPER_VOICE_CONFIG: ${PIPER_VOICE_CONFIG}`);
    console.log("[piper] Ready — waiting for requests.");
  } else {
    const missing = [
      ...(!PIPER_BIN         ? ["PIPER_BIN"]         : []),
      ...(!PIPER_VOICE_MODEL ? ["PIPER_VOICE_MODEL"] : []),
    ];
    console.warn(`[piper] ⚠  Not configured — missing env var(s): ${missing.join(", ")}`);
    console.warn("[piper]    POST /speak will return a 503 error until these are set.");
    console.warn("[piper]    See docs/setup/local-tts-server.md for setup instructions.");
  }
  console.log("[piper] Press Ctrl+C to stop.");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[piper] Port ${PORT} is already in use. ` +
      "Stop the process occupying it (mock server?) and try again."
    );
  } else {
    console.error("[piper] Server error:", err.message);
  }
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Jarvis local TTS mock server — development / transport testing only.
 *
 * Simulates the POST /speak contract that the Jarvis API route /tts/speak
 * expects from a real local TTS server (Piper, Kokoro, etc.).
 *
 * Returns a short 440 Hz sine-wave beep as a valid WAV file so the full
 * audio playback path in the frontend (fetch → Blob → object URL →
 * HTMLAudioElement) can be exercised without installing any real TTS engine.
 *
 * The mock does NOT synthesise the actual text — it always returns the same
 * beep regardless of input.  It is purely a transport / integration test.
 *
 * Usage:
 *   npm run dev:tts-mock        (from the project root)
 *   node scripts/local-tts-mock-server.mjs
 *
 * Then create / update  apps/api/.env  with:
 *   LOCAL_TTS_ENABLED=true
 *   LOCAL_TTS_BASE_URL=http://localhost:5005
 *   LOCAL_TTS_PROVIDER=mock
 *
 * Restart the Jarvis API (npm run dev:api), select "Local TTS" in the UI,
 * click "Test voice" — the beep should play.
 *
 * ⚠  DO NOT use in production.  This server is not secured and not a real TTS
 *    engine.  Stop it and set LOCAL_TTS_ENABLED=false (or delete apps/api/.env)
 *    when you are done testing.
 *
 * Requires: Node.js ≥ 20 (built-in http module only — no npm install needed).
 */

import { createServer } from "node:http";

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = 5005;
const BIND = "127.0.0.1"; // localhost only — never 0.0.0.0

// Beep parameters
const BEEP_FREQUENCY_HZ  = 440;   // Concert A
const BEEP_DURATION_S    = 0.4;   // seconds
const BEEP_SAMPLE_RATE   = 22050; // Hz
const BEEP_AMPLITUDE     = 8000;  // 0–32767 range; keeps volume moderate

// ─── WAV generation ──────────────────────────────────────────────────────────

/**
 * Generates a minimal valid WAV buffer containing a sine-wave tone.
 * Format: PCM, 16-bit, mono, 22050 Hz.
 * A short linear fade-in and fade-out prevents audible clicks at the edges.
 *
 * @returns {Buffer}
 */
function generateBeepWav() {
  const numSamples = Math.floor(BEEP_SAMPLE_RATE * BEEP_DURATION_S);
  const dataSize   = numSamples * 2; // 16-bit mono = 2 bytes per sample
  const buf        = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4); // total chunk size
  buf.write("WAVE", 8, "ascii");

  // fmt sub-chunk — PCM, mono, 22050 Hz, 16-bit
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);                        // sub-chunk size (always 16 for PCM)
  buf.writeUInt16LE(1,  20);                        // audio format: 1 = PCM
  buf.writeUInt16LE(1,  22);                        // num channels: 1 (mono)
  buf.writeUInt32LE(BEEP_SAMPLE_RATE,      24);     // sample rate
  buf.writeUInt32LE(BEEP_SAMPLE_RATE * 2,  28);     // byte rate = sampleRate × channels × bitsPerSample/8
  buf.writeUInt16LE(2,  32);                        // block align = channels × bitsPerSample/8
  buf.writeUInt16LE(16, 34);                        // bits per sample

  // data sub-chunk
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  // PCM samples — sine wave with 10 % linear fade-in and 10 % fade-out
  const fadeLen = numSamples * 0.1;
  for (let i = 0; i < numSamples; i++) {
    const fade =
      i < fadeLen               ? i / fadeLen :
      i > numSamples - fadeLen  ? (numSamples - i) / fadeLen :
      1;
    const sine   = Math.sin((2 * Math.PI * BEEP_FREQUENCY_HZ * i) / BEEP_SAMPLE_RATE);
    const sample = Math.round(BEEP_AMPLITUDE * fade * sine);
    buf.writeInt16LE(sample, 44 + i * 2);
  }

  return buf;
}

// Pre-generate the WAV once at startup — it never changes between requests.
const BEEP_WAV = generateBeepWav();

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  // GET / — status page (useful for quick browser check)
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Jarvis local TTS mock server\n" +
      "────────────────────────────\n" +
      "This is a development-only mock.  It does NOT perform real text-to-speech.\n" +
      "\n" +
      `POST /speak → returns a ${BEEP_FREQUENCY_HZ} Hz beep WAV (${BEEP_DURATION_S} s)\n` +
      `Port: ${PORT}\n`
    );
    return;
  }

  // POST /speak — mock TTS endpoint
  if (req.method === "POST" && req.url === "/speak") {
    let rawBody = "";

    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", () => {
      // Parse the body so we can log the incoming text (helps with debugging).
      let parsed = {};
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        // Non-JSON body — safe to ignore; we return the beep regardless.
      }

      const text = typeof parsed.text === "string" ? parsed.text.trim() : "(no text)";
      const lang  = typeof parsed.lang  === "string" ? parsed.lang  : "—";
      const voice = typeof parsed.voice === "string" ? parsed.voice : "—";

      // Truncate for readability in the terminal
      const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
      console.log(`[mock-tts] POST /speak  lang="${lang}"  voice="${voice}"  text="${preview}"`);

      res.writeHead(200, {
        "Content-Type":   "audio/wav",
        "Content-Length": String(BEEP_WAV.length),
      });
      res.end(BEEP_WAV);
    });

    req.on("error", () => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Bad request." }));
    });

    return;
  }

  // 404 for any other path/method
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found." }));
});

server.listen(PORT, BIND, () => {
  console.log(`[mock-tts] Jarvis TTS mock server running at http://${BIND}:${PORT}`);
  console.log(`[mock-tts] POST /speak → ${BEEP_FREQUENCY_HZ} Hz beep WAV (mock transport test — no real TTS)`);
  console.log("[mock-tts] To use: set LOCAL_TTS_ENABLED=true in apps/api/.env and restart the API.");
  console.log("[mock-tts] Press Ctrl+C to stop.");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[mock-tts] Port ${PORT} is already in use. Stop the process occupying it and try again.`);
  } else {
    console.error("[mock-tts] Server error:", err.message);
  }
  process.exit(1);
});

// Local TTS proxy route.
//
// POST /tts/speak
//   Forwards a text-to-speech request to a locally configured TTS server
//   (e.g. Piper, Kokoro) and returns the audio bytes to the frontend.
//
// Security properties:
//   - Only operates when LOCAL_TTS_ENABLED=true (off by default).
//   - The upstream URL is locked to localhost at config load time (see config.ts).
//     The frontend never supplies a URL — it only sends text/lang/voice.
//   - Text is validated and length-capped before forwarding.
//   - A 20-second timeout prevents the route from hanging indefinitely.
//   - Non-audio upstream responses are never forwarded raw; only audio/* bytes pass through.

import { Router, Request, Response } from "express";
import { config } from "../config";

const router = Router();

// Maximum characters accepted in a single TTS request.
// Keeps individual requests reasonable and matches typical utterance lengths.
const MAX_TEXT_LENGTH = 4000;

// POST /tts/speak
// Body: { text: string, lang?: string, voice?: string }
// Response (success): audio bytes with appropriate content-type (audio/wav, audio/mpeg, …)
// Response (failure): { ok: false, error: string }
router.post(
  "/speak",
  async (req: Request, res: Response): Promise<void> => {
    const { text, lang, voice } = req.body as {
      text?: unknown;
      lang?: unknown;
      voice?: unknown;
    };

    // --- Input validation ---

    if (typeof text !== "string" || !text.trim()) {
      res.json({ ok: false, error: "text must be a non-empty string." });
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      res.json({
        ok: false,
        error: `text exceeds the maximum length of ${MAX_TEXT_LENGTH} characters.`,
      });
      return;
    }

    // lang and voice are optional; clamp to sane lengths to prevent header bloat.
    const safeLang =
      typeof lang === "string" ? lang.slice(0, 20) : undefined;
    const safeVoice =
      typeof voice === "string" ? voice.slice(0, 200) : undefined;

    // --- Enabled check ---

    if (!config.localTts.enabled) {
      res.json({
        ok: false,
        error:
          "Local TTS is not enabled. " +
          "Set LOCAL_TTS_ENABLED=true in apps/api/.env to activate it.",
      });
      return;
    }

    // --- Forward to local TTS server ---

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);

    try {
      const upstream = await fetch(
        `${config.localTts.baseUrl}/speak`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text.trim(),
            lang: safeLang,
            voice: safeVoice,
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      const contentType = upstream.headers.get("content-type") ?? "";

      // Return audio bytes directly — this is the happy path.
      if (upstream.ok && contentType.startsWith("audio/")) {
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.setHeader("Content-Type", contentType);
        res.send(buffer);
        return;
      }

      // Non-audio response — attempt to extract a human-readable error message.
      let errorMessage = `Local TTS server responded with HTTP ${upstream.status}.`;
      try {
        const data = (await upstream.json()) as {
          error?: string;
          message?: string;
        };
        if (data.error) errorMessage = data.error;
        else if (data.message) errorMessage = data.message;
      } catch {
        // Response body was not JSON — the status-based message is sufficient.
      }
      res.json({ ok: false, error: errorMessage });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        res.json({
          ok: false,
          error: "Local TTS server timed out after 20 seconds.",
        });
        return;
      }
      res.json({
        ok: false,
        error:
          "Could not reach the local TTS server. " +
          "Is it running on the configured port?",
      });
    }
  }
);

export default router;

import { Router, Request, Response } from "express";
import { config } from "../config";
import {
  getOllamaModels,
  resolveModel,
  callOllamaChat,
  streamOllamaChat,
  JARVIS_SYSTEM_PROMPT,
} from "../services/ollama";

const router = Router();

// Shared helper — validate and resolve the model for an incoming chat request.
// Returns { message, model } on success, writes an error response and returns null on failure.
async function validateAndResolve(
  req: Request,
  res: Response
): Promise<{ message: string; model: string } | null> {
  const { message, model: requestedModel } = req.body as {
    message?: unknown;
    model?: unknown;
  };

  if (typeof message !== "string" || message.trim() === "") {
    res.json({
      ok: false,
      model: config.ollama.defaultModel,
      message: "",
      error: "Request body must include a non-empty `message` string.",
    });
    return null;
  }

  const requested =
    typeof requestedModel === "string" && requestedModel.trim() !== ""
      ? requestedModel.trim()
      : undefined;

  try {
    const models = await getOllamaModels();
    const installedNames = models.map((m) => m.name);
    const model = resolveModel(installedNames, requested);
    return { message: message.trim(), model };
  } catch (err: unknown) {
    const errorText =
      err instanceof Error ? err.message : "Unknown error contacting Ollama";
    res.json({
      ok: false,
      model: requested ?? config.ollama.defaultModel,
      message: "",
      error: errorText,
    });
    return null;
  }
}

// POST /chat
// Non-streaming. Returns the full response once Ollama finishes.
// Body: { message: string, model?: string }
// Always returns HTTP 200; check `ok` field for success/failure.
router.post("/", async (req: Request, res: Response) => {
  const resolved = await validateAndResolve(req, res);
  if (!resolved) return;

  const { message, model } = resolved;

  try {
    const content = await callOllamaChat(model, message, JARVIS_SYSTEM_PROMPT);
    res.json({ ok: true, model, message: content });
  } catch (err: unknown) {
    const errorText =
      err instanceof Error ? err.message : "Unknown error contacting Ollama";
    res.json({ ok: false, model, message: "", error: errorText });
  }
});

// POST /chat/stream
// Streaming. Sends newline-delimited JSON chunks as Ollama generates tokens.
// Body: { message: string, model?: string }
//
// Each chunk is one of:
//   {"type":"token","content":"..."}   — a partial token from Ollama
//   {"type":"done","model":"..."}      — generation finished successfully
//   {"type":"error","error":"..."}     — something went wrong
router.post("/stream", async (req: Request, res: Response) => {
  const resolved = await validateAndResolve(req, res);
  if (!resolved) return;

  const { message, model } = resolved;

  // Set headers for a chunked plain-text stream
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  // Disable proxy buffering (e.g. nginx) so chunks reach the browser immediately
  res.setHeader("X-Accel-Buffering", "no");

  try {
    for await (const token of streamOllamaChat(
      model,
      message,
      JARVIS_SYSTEM_PROMPT
    )) {
      res.write(JSON.stringify({ type: "token", content: token }) + "\n");
    }
    res.write(JSON.stringify({ type: "done", model }) + "\n");
    res.end();
  } catch (err: unknown) {
    const errorText =
      err instanceof Error ? err.message : "Unknown streaming error";
    // Write the error as a chunk — the response may have already started
    res.write(JSON.stringify({ type: "error", error: errorText }) + "\n");
    res.end();
  }
});

export default router;

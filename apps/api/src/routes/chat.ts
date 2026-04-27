import { Router, Request, Response } from "express";
import { config } from "../config";
import {
  getOllamaModels,
  resolveModel,
  callOllamaChat,
  streamOllamaChat,
  buildMessages,
  JARVIS_SYSTEM_PROMPT,
  OllamaMessage,
} from "../services/ollama";

const router = Router();

// Maximum number of history messages to accept from the frontend
const MAX_HISTORY = 12;
// Maximum character length per history message content
const MAX_CONTENT_LEN = 4000;

// Validate the `history` field from the request body.
// - Only role "user" or "assistant" are accepted (never "system").
// - Invalid items are silently dropped.
// - Content is truncated to MAX_CONTENT_LEN.
// - Total is capped at MAX_HISTORY messages.
function validateHistory(raw: unknown): OllamaMessage[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item)
    )
    .filter(
      (item) =>
        (item["role"] === "user" || item["role"] === "assistant") &&
        typeof item["content"] === "string" &&
        (item["content"] as string).trim() !== ""
    )
    .map((item) => ({
      role: item["role"] as "user" | "assistant",
      content: (item["content"] as string).slice(0, MAX_CONTENT_LEN),
    }))
    .slice(-MAX_HISTORY);
}

// Shared helper — validate message, history, and resolve the model.
// Returns { message, model, history } on success.
// Writes an error response and returns null on failure.
async function validateAndResolve(
  req: Request,
  res: Response
): Promise<{ message: string; model: string; history: OllamaMessage[] } | null> {
  const {
    message,
    model: requestedModel,
    history: rawHistory,
  } = req.body as {
    message?: unknown;
    model?: unknown;
    history?: unknown;
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

  const history = validateHistory(rawHistory);

  try {
    const models = await getOllamaModels();
    const installedNames = models.map((m) => m.name);
    const model = resolveModel(installedNames, requested);
    return { message: message.trim(), model, history };
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
// Body: { message: string, model?: string, history?: OllamaMessage[] }
// Always returns HTTP 200; check `ok` field for success/failure.
router.post("/", async (req: Request, res: Response) => {
  const resolved = await validateAndResolve(req, res);
  if (!resolved) return;

  const { message, model, history } = resolved;
  const messages = buildMessages(JARVIS_SYSTEM_PROMPT, history, message);

  try {
    const content = await callOllamaChat(model, messages);
    res.json({ ok: true, model, message: content });
  } catch (err: unknown) {
    const errorText =
      err instanceof Error ? err.message : "Unknown error contacting Ollama";
    res.json({ ok: false, model, message: "", error: errorText });
  }
});

// POST /chat/stream
// Streaming. Sends newline-delimited JSON chunks as Ollama generates tokens.
// Body: { message: string, model?: string, history?: OllamaMessage[] }
//
// Each chunk is one of:
//   {"type":"token","content":"..."}   — a partial token from Ollama
//   {"type":"done","model":"..."}      — generation finished successfully
//   {"type":"error","error":"..."}     — something went wrong
router.post("/stream", async (req: Request, res: Response) => {
  const resolved = await validateAndResolve(req, res);
  if (!resolved) return;

  const { message, model, history } = resolved;
  const messages = buildMessages(JARVIS_SYSTEM_PROMPT, history, message);

  // Set headers for a chunked plain-text stream
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  // Disable proxy buffering (e.g. nginx) so chunks reach the browser immediately
  res.setHeader("X-Accel-Buffering", "no");

  try {
    for await (const token of streamOllamaChat(model, messages)) {
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

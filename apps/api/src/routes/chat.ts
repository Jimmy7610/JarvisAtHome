import { Router, Request, Response } from "express";
import { config } from "../config";
import { getOllamaModels, resolveModel, callOllamaChat } from "../services/ollama";

const router = Router();

// System prompt that gives Jarvis its identity
const SYSTEM_PROMPT =
  "You are Jarvis, a local-first personal AI assistant for Jimmy Eliasson. " +
  "You are helpful, calm, practical and concise. " +
  "You run locally through Ollama only.";

// POST /chat
// Body: { message: string, model?: string }
// Always returns HTTP 200; check `ok` field for success/failure.
router.post("/", async (req: Request, res: Response) => {
  const { message, model: requestedModel } = req.body as {
    message?: unknown;
    model?: unknown;
  };

  // Validate that message is a non-empty string
  if (typeof message !== "string" || message.trim() === "") {
    res.json({
      ok: false,
      model: config.ollama.defaultModel,
      message: "",
      error: "Request body must include a non-empty `message` string.",
    });
    return;
  }

  const requested =
    typeof requestedModel === "string" && requestedModel.trim() !== ""
      ? requestedModel.trim()
      : undefined;

  try {
    // Fetch installed models and resolve which one to use
    const models = await getOllamaModels();
    const installedNames = models.map((m) => m.name);
    const model = resolveModel(installedNames, requested);

    const content = await callOllamaChat(model, message.trim(), SYSTEM_PROMPT);

    res.json({ ok: true, model, message: content });
  } catch (err: unknown) {
    const errorText =
      err instanceof Error ? err.message : "Unknown error contacting Ollama";

    res.json({
      ok: false,
      model: requested ?? config.ollama.defaultModel,
      message: "",
      error: errorText,
    });
  }
});

export default router;

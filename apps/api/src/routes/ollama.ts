import { Router } from "express";
import { config } from "../config";
import { getOllamaModels, resolveModel } from "../services/ollama";

const router = Router();

// GET /ollama/status
// Probes the local Ollama instance and returns model info.
// Always returns HTTP 200 — the `ok` field indicates whether Ollama is reachable.
// A missing configured default model does NOT mean Ollama is offline.
router.get("/status", async (_req, res) => {
  const { baseUrl, defaultModel: configuredDefaultModel } = config.ollama;

  try {
    const models = await getOllamaModels();
    const installedNames = models.map((m) => m.name);

    // Resolve which model would actually be used for chat (no specific request)
    const resolvedDefaultModel =
      installedNames.length > 0 ? resolveModel(installedNames) : null;

    res.json({
      ok: true,
      baseUrl,
      configuredDefaultModel,
      resolvedDefaultModel,
      models,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error contacting Ollama";

    res.json({
      ok: false,
      baseUrl,
      configuredDefaultModel,
      resolvedDefaultModel: null,
      models: [],
      error: message,
    });
  }
});

export default router;

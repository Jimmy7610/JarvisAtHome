import { Router } from "express";
import { config } from "../config";

const router = Router();

// Shape returned by Ollama GET /api/tags
interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

// GET /ollama/status
// Probes the local Ollama instance and returns model info.
// Always returns HTTP 200 — the `ok` field indicates whether Ollama is reachable.
router.get("/status", async (_req, res) => {
  const { baseUrl, defaultModel } = config.ollama;

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      // Fail fast if Ollama is not running locally
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      res.json({
        ok: false,
        baseUrl,
        defaultModel,
        models: [],
        error: `Ollama responded with HTTP ${response.status}`,
      });
      return;
    }

    const data = (await response.json()) as OllamaTagsResponse;

    // Only surface the fields the frontend needs
    const models = (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
    }));

    res.json({ ok: true, baseUrl, defaultModel, models });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error contacting Ollama";

    res.json({
      ok: false,
      baseUrl,
      defaultModel,
      models: [],
      error: message,
    });
  }
});

export default router;

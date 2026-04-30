import { Router } from "express";
import { config } from "../config";

const router = Router();

// GET /settings
// Returns safe, read-only application configuration and feature flags.
//
// SECURITY CONTRACT — this endpoint must NEVER expose:
//   - API keys, tokens, or passwords
//   - Database credentials or connection strings
//   - File system paths beyond the workspace label
//   - Any secret from .env
//
// All values returned here are either hardcoded constants or non-sensitive
// config (localhost URLs, model names, boolean feature flags).
router.get("/", (_req, res) => {
  res.json({
    ok: true,

    // ── App identity ──────────────────────────────────────────────────────────
    appVersion: "1.2.2",
    apiVersion: "0.1.0",
    environment: "local",

    // ── Ollama config ─────────────────────────────────────────────────────────
    // baseUrl is always a localhost address (enforced in config.ts) — safe to expose.
    ollama: {
      baseUrl: config.ollama.baseUrl,
      defaultModel: config.ollama.defaultModel,
    },

    // ── Feature flags (read-only booleans) ────────────────────────────────────
    features: {
      // File tools
      fileWriteEnabled: true,
      fileWriteRequiresApproval: true,
      workspaceFilesEnabled: true,
      projectLibraryEnabled: true,
      projectLibraryReadOnly: true,
      draftsEnabled: true,
      // Communication tools
      emailSendEnabled: false,
      // Terminal / system tools
      terminalToolsEnabled: false,
      // Cloud AI — ALWAYS false: Jarvis is Ollama-only
      cloudAiEnabled: false,
      // Voice / TTS — driven by env var; localhost only if enabled
      localTtsEnabled: config.localTts.enabled,
    },

    // ── Safety summary ────────────────────────────────────────────────────────
    safety: {
      ollamaOnly: true,
      workspaceLabel: "workspace/",
    },
  });
});

export default router;

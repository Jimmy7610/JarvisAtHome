// Centralised runtime config — read once, used everywhere in the API
import path from "path";

// Default DB path: <project-root>/data/memory/jarvis.sqlite
// __dirname is apps/api/src at runtime, so three levels up reaches the project root.
const defaultDbPath = path.resolve(
  __dirname,
  "../../../data/memory/jarvis.sqlite"
);

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    defaultModel: process.env.OLLAMA_DEFAULT_MODEL || "qwen2.5-coder:latest",
  },
  dbPath: process.env.JARVIS_DB_PATH || defaultDbPath,
} as const;

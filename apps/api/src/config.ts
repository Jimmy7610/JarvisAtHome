// Centralised runtime config — read once, used everywhere in the API
import path from "path";

// __dirname is apps/api/src at runtime, so three levels up reaches the project root.
const projectRoot = path.resolve(__dirname, "../../..");

// Default DB path: <project-root>/data/memory/jarvis.sqlite
const defaultDbPath = path.join(projectRoot, "data/memory/jarvis.sqlite");

// Default allowed workspace for file tools: <project-root>/workspace
// Override with JARVIS_ALLOWED_WORKSPACE (absolute or relative to cwd)
const defaultWorkspace = path.join(projectRoot, "workspace");

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    defaultModel: process.env.OLLAMA_DEFAULT_MODEL || "qwen2.5-coder:latest",
  },
  dbPath: process.env.JARVIS_DB_PATH || defaultDbPath,
  // Absolute path to the workspace directory that file tools are allowed to read.
  // All file operations are sandboxed to this directory — no path can escape it.
  allowedWorkspace: process.env.JARVIS_ALLOWED_WORKSPACE
    ? path.resolve(process.env.JARVIS_ALLOWED_WORKSPACE)
    : defaultWorkspace,
} as const;

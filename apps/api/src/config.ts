// Centralised runtime config — read once, used everywhere in the API
import path from "path";

// __dirname is apps/api/src at runtime, so three levels up reaches the project root.
const projectRoot = path.resolve(__dirname, "../../..");

// Default DB path: <project-root>/data/memory/jarvis.sqlite
const defaultDbPath = path.join(projectRoot, "data/memory/jarvis.sqlite");

// Default allowed workspace for file tools: <project-root>/workspace
// Override with JARVIS_ALLOWED_WORKSPACE (absolute or relative to cwd)
const defaultWorkspace = path.join(projectRoot, "workspace");

// Safety guard: LOCAL_TTS_BASE_URL must point to localhost/127.0.0.1/::1.
// Arbitrary outbound URLs would turn the /tts/speak route into an open proxy.
// Falls back to the default and emits a console warning if the value is rejected.
const LOCAL_TTS_BASE_URL_DEFAULT = "http://localhost:5005";

function ensureLocalhost(rawUrl: string, fallback: string): string {
  try {
    const { hostname } = new URL(rawUrl);
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return rawUrl;
    }
  } catch {
    // Malformed URL — fall through to the fallback
  }
  console.warn(
    `[Jarvis] LOCAL_TTS_BASE_URL must point to localhost or 127.0.0.1. ` +
      `Ignoring configured value, using default ${fallback}`
  );
  return fallback;
}

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
  // Local TTS server — optional, disabled by default.
  // Only localhost URLs are accepted (see ensureLocalhost above).
  // Piper/Kokoro or any compatible local HTTP TTS server can be configured here.
  localTts: {
    enabled: process.env.LOCAL_TTS_ENABLED === "true",
    baseUrl: ensureLocalhost(
      process.env.LOCAL_TTS_BASE_URL ?? LOCAL_TTS_BASE_URL_DEFAULT,
      LOCAL_TTS_BASE_URL_DEFAULT
    ),
    provider: process.env.LOCAL_TTS_PROVIDER || "generic",
  },
} as const;

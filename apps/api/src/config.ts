// Centralised runtime config — read once, used everywhere in the API
export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    defaultModel: process.env.OLLAMA_DEFAULT_MODEL || "qwen2.5-coder:latest",
  },
} as const;

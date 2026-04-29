// Load .env before any other imports so process.env is populated for config.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import { config } from "./config";
// Import db early so the schema is created before any request arrives
import "./services/db";
import ollamaRouter from "./routes/ollama";
import chatRouter from "./routes/chat";
import sessionsRouter from "./routes/sessions";
import filesRouter from "./routes/files";
import ttsRouter from "./routes/tts";
import projectsRouter from "./routes/projects";
import settingsRouter from "./routes/settings";
import memoryRouter from "./routes/memory";

const app = express();

// Allow requests from the Next.js frontend
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Root route
app.get("/", (_req, res) => {
  res.send("Jarvis API is running");
});

// Health check route
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "jarvis-api",
    version: "0.1.0",
  });
});

// Ollama routes — mounted at /ollama
app.use("/ollama", ollamaRouter);

// Chat routes — mounted at /chat
app.use("/chat", chatRouter);

// Session and message persistence routes — mounted at /sessions
app.use("/sessions", sessionsRouter);

// Read-only file tool routes — mounted at /files
// All operations sandboxed to config.allowedWorkspace
app.use("/files", filesRouter);

// Local TTS proxy routes — mounted at /tts
// Only active when LOCAL_TTS_ENABLED=true; always returns a safe JSON error otherwise.
// Upstream URL is locked to localhost (see config.ts).
app.use("/tts", ttsRouter);

// Project library routes — mounted at /projects
// Read-only access to workspace/projects/; sandboxed, no writes.
app.use("/projects", projectsRouter);

// Settings route — mounted at /settings
// Returns safe, read-only config/feature-flag snapshot. No secrets exposed.
app.use("/settings", settingsRouter);

// Memory routes — mounted at /memory
// Manual user-created notes/preferences. Never written autonomously by the AI.
// Not injected into the Ollama system prompt in v0.9.0.
app.use("/memory", memoryRouter);

app.listen(config.port, () => {
  console.log(`Jarvis API running on http://localhost:${config.port}`);
});

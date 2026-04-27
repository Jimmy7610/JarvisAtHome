import express from "express";
import cors from "cors";
import { config } from "./config";
import ollamaRouter from "./routes/ollama";

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

app.listen(config.port, () => {
  console.log(`Jarvis API running on http://localhost:${config.port}`);
});

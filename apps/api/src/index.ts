import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 4000;

// Allow requests from the Next.js frontend
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
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

app.listen(PORT, () => {
  console.log(`Jarvis API running on http://localhost:${PORT}`);
});

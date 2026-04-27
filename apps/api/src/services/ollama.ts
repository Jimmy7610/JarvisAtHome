import { config } from "../config";

// Text-focused models in preference order.
// Used when the configured default model is not installed.
// Vision models (llava, bakllava, etc.) are intentionally ranked below pure text models.
const PREFERRED_TEXT_MODELS = [
  "llama3.1:latest",
  "llama3:latest",
  "mistral:latest",
  "qwen2.5-coder:latest",
  "qwen2.5:latest",
];

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

// Fetch the list of installed models from Ollama.
// Throws if Ollama is unreachable or returns a non-200 status.
export async function getOllamaModels(): Promise<OllamaModel[]> {
  const response = await fetch(`${config.ollama.baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Ollama responded with HTTP ${response.status}`);
  }

  const data = (await response.json()) as { models: OllamaModel[] };
  return data.models ?? [];
}

// Pick the best model to use, given the list of installed model names and an
// optional model explicitly requested by the caller.
//
// Priority:
//   1. Requested model — if provided and installed.
//   2. Configured default (OLLAMA_DEFAULT_MODEL) — if installed.
//   3. First match from PREFERRED_TEXT_MODELS — if any are installed.
//   4. The first model in the installed list.
//
// Throws if no models are installed at all.
export function resolveModel(
  installedNames: string[],
  requestedModel?: string
): string {
  if (installedNames.length === 0) {
    throw new Error(
      "No Ollama models are installed. " +
        "Please install a model with: ollama pull llama3:latest"
    );
  }

  // Priority 1: explicitly requested model, if it is actually installed
  if (requestedModel && installedNames.includes(requestedModel)) {
    return requestedModel;
  }

  // Priority 2: configured default model, if installed
  if (installedNames.includes(config.ollama.defaultModel)) {
    return config.ollama.defaultModel;
  }

  // Priority 3: first installed model that appears in our preferred text list
  for (const preferred of PREFERRED_TEXT_MODELS) {
    if (installedNames.includes(preferred)) return preferred;
  }

  // Priority 4: whatever is installed first
  return installedNames[0];
}

// Send a single-turn message to Ollama and return the assistant response text.
// Throws on network error, non-200 response, or empty reply.
export async function callOllamaChat(
  model: string,
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
    // 60 s — first-token latency on large models can be significant
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Ollama returned HTTP ${response.status}${text ? `: ${text}` : ""}`
    );
  }

  const data = (await response.json()) as {
    message?: { role: string; content: string };
    error?: string;
  };

  const content = data.message?.content ?? "";
  if (!content) {
    throw new Error(data.error ?? "Ollama returned an empty response.");
  }

  return content;
}

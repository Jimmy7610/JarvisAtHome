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

// Shared Jarvis identity prompt — used by both /chat and /chat/stream
export const JARVIS_SYSTEM_PROMPT =
  "You are Jarvis, a local-first personal AI assistant for Jimmy Eliasson. " +
  "You are helpful, calm, practical and concise. " +
  "You run locally through Ollama only.\n\n" +
  "## Workspace file proposals\n\n" +
  "When the user asks you to create, update, or propose a change to a workspace file, " +
  "you MUST respond with ONLY the fenced block shown below. " +
  "The marker `jarvis-write-proposal` is MANDATORY — never omit it, never replace it.\n\n" +
  "CORRECT — the ONLY accepted format:\n" +
  "```jarvis-write-proposal\n" +
  '{"path":"relative/path/to/file.md","content":"full new file content here"}\n' +
  "```\n\n" +
  "WRONG — never output only a bare JSON object (the fence and marker are required):\n" +
  '{"path":"file.md","content":"content"}\n\n' +
  "WRONG — never use a plain fence without the marker:\n" +
  "```\n" +
  '{"path":"file.md","content":"content"}\n' +
  "```\n\n" +
  "WRONG — never use ```json instead of ```jarvis-write-proposal:\n" +
  "```json\n" +
  '{"path":"file.md","content":"content"}\n' +
  "```\n\n" +
  "Rules for workspace file proposals:\n" +
  "- The opening fence line MUST be exactly: ```jarvis-write-proposal\n" +
  "- Never output a bare JSON object — the fence and marker are not optional.\n" +
  "- Never use ```json or plain ``` as the fence type. Only ```jarvis-write-proposal is accepted.\n" +
  "- Output ONLY the fenced block. Do not write any text before or after it.\n" +
  "- Do not say 'Proposal Submitted', 'Here is the proposal', or anything similar.\n" +
  "- Do not use Markdown headings, bullet points, or prose around the block.\n" +
  "- The path must be relative to the workspace directory (e.g. 'welcome.md' or 'drafts/notes.md').\n" +
  "- The content must be the complete new file content as a JSON string (escape newlines as \\n, escape double-quotes as \\\").\n" +
  "- CRITICAL: Never put literal newline characters inside the JSON string values. Use the \\n escape sequence instead.\n" +
  "- CRITICAL: The entire JSON object must fit on a single line between the opening and closing fences. No line breaks inside the JSON.\n" +
  "- The JSON inside the block must be valid JSON with exactly two keys: path and content.\n" +
  "- The proposal is not written automatically. The user must click 'Approve write' in the UI.\n" +
  "- Only use this format when the user explicitly asks to create or change a workspace file.\n" +
  "- For all other questions and tasks, respond normally.\n\n" +
  "## Local email drafts\n\n" +
  "When the user asks you to write, draft, compose, or create an email, " +
  "create a local Markdown draft file in the workspace using the write proposal format above. " +
  "Output only the proposal block — do not explain the format.\n\n" +
  "Default path: drafts/<subject-slug>.md (e.g. drafts/cleaning-day-board.md).\n" +
  "Derive the filename from the email subject: lowercase, hyphens instead of spaces, .md extension.\n\n" +
  "Format the draft content as a readable Markdown file:\n" +
  "# Email Draft: <Subject>\n\n" +
  "To: <recipient>\n" +
  "Subject: <subject line>\n\n" +
  "<email body>\n\n" +
  "<sign-off, e.g. Best regards, Jimmy>\n\n" +
  "Rules for local email drafts:\n" +
  "- NEVER send emails. You have no ability to send emails and must not attempt to.\n" +
  "- NEVER ask for email credentials, passwords, tokens, or API keys.\n" +
  "- NEVER mention Gmail, Outlook, SMTP, SendGrid, or any email service.\n" +
  "- NEVER claim the email was sent, will be sent, or is queued to send.\n" +
  "- The draft is a local Markdown file. It is only written to disk after the user clicks Approve write.\n" +
  "- If the user asks you to send an email, explain that you cannot send emails and offer to save a local draft instead.\n\n" +
  "## Multi-file workspace proposals (v2)\n\n" +
  "When the user asks to create or update MULTIPLE files at once, respond with a v2 proposal block:\n" +
  "```jarvis-write-proposal\n" +
  "{\"type\":\"workspace_write_proposal\",\"version\":2,\"summary\":\"Brief description\",\"files\":[{\"operation\":\"create\",\"path\":\"sandbox/example.md\",\"content\":\"# Example\\n\"},{\"operation\":\"update\",\"path\":\"existing.md\",\"content\":\"# Updated\\n\"}]}\n" +
  "```\n\n" +
  "v2 rules: operation must be 'create' or 'update'. Maximum 5 files per proposal. No delete operation. " +
  "The user must click 'Approve all' before any file is written — nothing is written automatically. " +
  "For a single file, use the v1 format (path + content only, no type/version/files fields).\n\n" +
  "## Agent workflow plans\n\n" +
  "When the user asks for a step-by-step plan or multi-step workflow, respond with a jarvis-agent-plan block:\n" +
  "```jarvis-agent-plan\n" +
  "{\"type\":\"jarvis_agent_plan\",\"version\":1,\"title\":\"Plan title\",\"summary\":\"Brief description\",\"steps\":[{\"id\":\"1\",\"title\":\"Step title\",\"description\":\"What this step involves.\",\"kind\":\"analysis\",\"status\":\"planned\"}]}\n" +
  "```\n\n" +
  "Agent plan rules: Plans are for user review only — steps never run automatically. " +
  "Do not claim any step has been executed or will execute automatically. " +
  "If a step involves writing files, a separate jarvis-write-proposal block must be submitted and approved by the user in the normal way. " +
  "Maximum 10 steps. kind must be one of: analysis, code, docs, test, review. " +
  "Set status to 'planned' for all steps in a new plan.";

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

// A single message in the Ollama messages array
export interface OllamaMessage {
  role: string;
  content: string;
}

// Build the full messages array to send to Ollama.
// Order: system prompt → validated history → current user message.
export function buildMessages(
  systemPrompt: string,
  history: OllamaMessage[],
  userMessage: string
): OllamaMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];
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

// Send a conversation to Ollama and return the full assistant response text.
// `messages` must already be fully built (system + history + user turn).
// Throws on network error, non-200 response, or empty reply.
export async function callOllamaChat(
  model: string,
  messages: OllamaMessage[]
): Promise<string> {
  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages,
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

// Stream a conversation to Ollama, yielding content tokens as they arrive.
// `messages` must already be fully built (system + history + user turn).
// The caller is responsible for writing tokens to the HTTP response.
// Throws if Ollama is unreachable or returns a non-200 status.
export async function* streamOllamaChat(
  model: string,
  messages: OllamaMessage[]
): AsyncGenerator<string> {
  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages,
    }),
    // Generous timeout for streaming — long responses can take several minutes
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Ollama returned HTTP ${response.status}${text ? `: ${text}` : ""}`
    );
  }

  if (!response.body) {
    throw new Error("Ollama streaming response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Ollama sends one JSON object per line
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as {
          message?: { role: string; content: string };
          done?: boolean;
        };
        const token = chunk.message?.content ?? "";
        if (token) yield token;
        if (chunk.done) return;
      }
    }

    // Flush any remaining buffered content
    if (buffer.trim()) {
      const chunk = JSON.parse(buffer) as {
        message?: { role: string; content: string };
      };
      const token = chunk.message?.content ?? "";
      if (token) yield token;
    }
  } finally {
    reader.releaseLock();
  }
}

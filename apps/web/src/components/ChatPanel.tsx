"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

// ─── Local speech API type shims ──────────────────────────────────────────────
//
// TypeScript 5.9 + Next.js 14 does not expose SpeechRecognition or
// SpeechSynthesis as global types in its build-time type checker.
// We define the minimal shapes we need locally so the code compiles without
// relying on DOM lib globals that may or may not be present.
// All runtime access goes through the JarvisWindow intersection cast.

interface JarvisRecognitionAlternative {
  readonly transcript: string;
}
interface JarvisRecognitionResult {
  readonly length: number;
  [index: number]: JarvisRecognitionAlternative;
}
interface JarvisRecognitionResultList {
  readonly length: number;
  [index: number]: JarvisRecognitionResult;
}
interface JarvisRecognitionEvent {
  readonly results: JarvisRecognitionResultList;
}
interface JarvisRecognitionErrorEvent {
  readonly error: string;
}
interface JarvisRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: JarvisRecognitionEvent) => void) | null;
  onerror: ((event: JarvisRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type JarvisRecognitionCtor = new () => JarvisRecognition;

// Minimal shape of a SpeechSynthesisVoice.
// Only the fields used by Jarvis are listed here.
interface JarvisVoice {
  readonly name: string;
  readonly lang: string;
}

interface JarvisUtterance {
  lang: string;
  voice: JarvisVoice | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type JarvisUtteranceCtor = new (text: string) => JarvisUtterance;

interface JarvisSpeechSynthesis {
  readonly paused: boolean;
  onvoiceschanged: (() => void) | null;
  cancel(): void;
  resume(): void;
  speak(utterance: JarvisUtterance): void;
  getVoices(): JarvisVoice[];
}

// Runtime window type carrying all Speech API properties.
// Used exclusively for runtime casts — never inferred or widened.
type JarvisWindow = Window & {
  SpeechRecognition?: JarvisRecognitionCtor;
  webkitSpeechRecognition?: JarvisRecognitionCtor;
  speechSynthesis?: JarvisSpeechSynthesis;
  SpeechSynthesisUtterance?: JarvisUtteranceCtor;
};

// ─── Write proposal types (mirrors WorkspacePanel) ────────────────────────────

type DiffLine = {
  type: "unchanged" | "added" | "removed";
  content: string;
};

type DisplayLine = DiffLine | { type: "gap"; count: number };

const DIFF_CONTEXT = 5;

function getDisplayLines(diff: DiffLine[]): DisplayLine[] {
  const firstChange = diff.findIndex((l) => l.type !== "unchanged");
  if (firstChange === -1) {
    if (diff.length <= DIFF_CONTEXT) return [...diff];
    return [
      { type: "gap", count: diff.length - DIFF_CONTEXT },
      ...diff.slice(diff.length - DIFF_CONTEXT),
    ];
  }
  const lastChange =
    diff.length -
    1 -
    [...diff].reverse().findIndex((l) => l.type !== "unchanged");
  const result: DisplayLine[] = [];
  const leadStart = Math.max(0, firstChange - DIFF_CONTEXT);
  if (leadStart > 0) result.push({ type: "gap", count: leadStart });
  for (let i = leadStart; i < firstChange; i++) result.push(diff[i]);
  for (let i = firstChange; i <= lastChange; i++) result.push(diff[i]);
  const trailEnd = Math.min(diff.length - 1, lastChange + DIFF_CONTEXT);
  for (let i = lastChange + 1; i <= trailEnd; i++) result.push(diff[i]);
  if (trailEnd < diff.length - 1)
    result.push({ type: "gap", count: diff.length - 1 - trailEnd });
  return result;
}

// ─── Robust write-proposal extractor ─────────────────────────────────────────
//
// Ollama models are inconsistent about markdown fence syntax — they sometimes omit
// the closing ```, put the tag on the same line as the opening fence, or on the
// next line.  Regex-based approaches that rely on fence structure have proven
// unreliable across these variants.
//
// Instead we use a two-step approach:
//   1. Find the literal marker string "jarvis-write-proposal" in the text.
//   2. Scan forward from the marker to find the first { and extract the complete
//      JSON object using brace balancing, correctly skipping braces inside strings
//      and handling all JSON escape sequences.
//
// The extracted JSON is only accepted if it parses successfully and contains
// non-empty `path` and `content` string fields. This prevents any prose from
// being misidentified as a proposal.

// ─── Multiline-JSON repair fallback ──────────────────────────────────────────
//
// Local Ollama models sometimes emit literal newline characters inside JSON
// string values instead of the required \n escape sequence.  This makes
// JSON.parse throw even though the proposal intent is completely clear from
// context.  For example a model may output:
//
//   {"path":"drafts/foo.md","content":"# Hello
//
//   Body text here
//   "}
//
// instead of the correct single-line form:
//   {"path":"drafts/foo.md","content":"# Hello\n\nBody text here\n"}
//
// This function is called ONLY after JSON.parse fails AND the
// jarvis-write-proposal marker was already confirmed present by
// extractWriteProposal.  It uses strict pattern matching to extract the two
// required fields independently rather than attempting a generic JSON fix:
//
//   path    — regex-matched; must contain no newlines, quotes, or traversal.
//   content — sliced from after "content":" to just before the final "}.
//             Literal newlines in the slice are preserved as actual file
//             content (which is what the model intended them to be).
//
// Returns null if either field cannot be reliably extracted.
// The backend re-validates all paths before any write — these checks are
// defence-in-depth only.
function repairMultilineProposalJson(
  jsonBody: string
): { path: string; content: string } | null {
  // Extract path — simple relative path, no newlines, no backslashes, no quotes
  const pathMatch = /"path"\s*:\s*"([^"\r\n\\]+)"/.exec(jsonBody);
  if (!pathMatch) return null;
  const proposalPath = pathMatch[1].trim();
  if (!proposalPath) return null;

  // Reject absolute paths (/ or Windows drive letter) and traversal sequences.
  // Backend resolveWorkspacePath is the authoritative guard; we fail fast here.
  if (/^[/\\]/.test(proposalPath) || /^[A-Za-z]:/.test(proposalPath)) return null;
  if (
    proposalPath.includes("../") ||
    proposalPath.includes("..\\") ||
    proposalPath.includes("/..") ||
    proposalPath.includes("\\..")
  )
    return null;

  // Find the start of the content value — the character immediately after "content":"
  const contentKeyMatch = /"content"\s*:\s*"/.exec(jsonBody);
  if (!contentKeyMatch) return null;
  const contentValueStart = contentKeyMatch.index + contentKeyMatch[0].length;

  // Find the end of the content value — the last " followed by optional whitespace
  // and } at the very end of the body.  This is the closing quote of the JSON object.
  const closingMatch = /"\s*\}\s*$/.exec(jsonBody);
  if (!closingMatch) return null;
  const contentValueEnd = closingMatch.index;

  if (contentValueEnd <= contentValueStart) return null;

  // Slice out the raw content.  It contains literal newlines (the model's mistake);
  // those are the actual line breaks the model intended to write into the file, so
  // we keep them as-is.  We do unescape any valid JSON escape sequences the model
  // may have correctly emitted within the content itself (\n won't appear here since
  // it used real newlines, but \" and \\ might).
  const rawContent = jsonBody.slice(contentValueStart, contentValueEnd);
  const content = rawContent
    .replace(/\\"/g, '"')    // \" → " (escaped quote inside content)
    .replace(/\\\\/g, "\\"); // \\ → \ (escaped backslash inside content)

  return { path: proposalPath, content };
}

// Internal result of extractWriteProposal — not exported.
interface ProposalExtract {
  blockStart: number; // index of the opening ``` (or the marker itself if no fence)
  blockEnd: number;   // index just past the last consumed character (incl. optional closing fence)
  jsonBody: string;   // the raw JSON string, ready for JSON.parse
}

// Locate the write proposal marker, walk back to the opening fence (if present),
// then extract the first complete JSON object using brace balancing.
function extractWriteProposal(text: string): ProposalExtract | null {
  const MARKER = "jarvis-write-proposal";

  // Step 1 — find the marker
  const markerPos = text.indexOf(MARKER);
  if (markerPos === -1) return null;

  // Step 2 — walk back from the marker to find where the block visually starts.
  // We look for an opening ``` fence either:
  //   • on the same line as the marker  (Format A: ```jarvis-write-proposal)
  //   • on the line immediately above   (Format B: ```\njarvis-write-proposal)
  let blockStart = markerPos; // fallback: start at the marker itself

  const markerLineStart = text.lastIndexOf("\n", markerPos - 1) + 1; // first char of marker's line
  const textBeforeMarkerOnLine = text.slice(markerLineStart, markerPos);
  const sameFenceIdx = textBeforeMarkerOnLine.indexOf("```");

  if (sameFenceIdx !== -1) {
    // Format A: opening fence and marker share a line
    blockStart = markerLineStart + sameFenceIdx;
  } else if (markerLineStart > 0) {
    // Check the line above for a bare opening fence (Format B)
    const prevLineEnd = markerLineStart - 1;
    const prevLineStart = text.lastIndexOf("\n", prevLineEnd - 1) + 1;
    const prevLine = text.slice(prevLineStart, prevLineEnd);
    const prevFenceIdx = prevLine.indexOf("```");
    if (prevFenceIdx !== -1 && prevLine.slice(0, prevFenceIdx).trim() === "") {
      blockStart = prevLineStart + prevFenceIdx;
    }
  }

  // Step 3 — scan forward from the end of the marker to the first {
  let jsonStart = -1;
  for (let i = markerPos + MARKER.length; i < text.length; i++) {
    if (text[i] === "{") {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart === -1) return null;

  // Step 4 — brace-balance to extract the complete JSON object.
  // Track whether we are inside a JSON string so that { and } inside string
  // values are not counted.  Handle all JSON escape sequences (\", \\, \n, …).
  let depth = 0;
  let inString = false;
  let i = jsonStart;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      if (ch === "\\") {
        i += 2; // skip the escaped character (handles \", \\, \n, \r, \t, …)
        continue;
      }
      if (ch === '"') inString = false;
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const jsonEnd = i + 1;
          // May be replaced with re-encoded JSON if the repair fallback fires.
          let jsonBody = text.slice(jsonStart, jsonEnd);

          // Validate: must be parseable JSON with a non-empty path string and a
          // content string.  If JSON.parse fails, attempt the multiline repair
          // fallback — local Ollama models sometimes emit literal newline
          // characters inside JSON string values instead of \n escape sequences.
          let parsed: { path?: unknown; content?: unknown };
          try {
            parsed = JSON.parse(jsonBody) as { path?: unknown; content?: unknown };
          } catch {
            // JSON.parse failed — try the multiline-JSON repair fallback.
            const repaired = repairMultilineProposalJson(jsonBody);
            if (!repaired) return null; // Cannot repair — not a valid proposal.
            // Re-encode as standard valid JSON so every downstream caller that
            // calls JSON.parse(result.jsonBody) works without modification.
            jsonBody = JSON.stringify({ path: repaired.path, content: repaired.content });
            parsed = repaired;
          }
          if (typeof parsed.path !== "string" || !parsed.path.trim()) return null;
          if (typeof parsed.content !== "string") return null;

          // Step 5 — consume the optional closing fence that follows the JSON object
          let blockEnd = jsonEnd;
          const afterJson = text.slice(jsonEnd);
          const closingFence = /^[ \t]*\r?\n[ \t]*```/.exec(afterJson);
          if (closingFence) blockEnd += closingFence[0].length;

          return { blockStart, blockEnd, jsonBody };
        }
      }
    }

    i++;
  }

  return null; // JSON object was never closed — incomplete response
}

// ─── Bare-JSON fallback extractor ─────────────────────────────────────────────
//
// Preferred format: the jarvis-write-proposal fenced block (handled by extractWriteProposal above).
// This fallback exists because local Ollama models sometimes omit the custom fence marker
// and output a bare JSON object or a plain fenced JSON block instead.
//
// STRICT conditions — the fallback ONLY fires when ALL of these hold:
//   1. The ENTIRE assistant response is just a JSON object or a single fenced block.
//      Any surrounding explanatory prose causes immediate rejection.
//   2. JSON.parse succeeds on the extracted body.
//   3. parsed.path is a non-empty string.
//   4. parsed.content is a string.
//
// The fallback still creates only a PENDING proposal — backend validation and the
// user's Approve click are still required before any file is written.
//
// Accepted:
//   Raw JSON only:    {"path":"file.md","content":"# Hello\nWorld"}
//   Fenced JSON only: ```json\n{...}\n```  or  ```\n{...}\n```
//
// Rejected:
//   Any surrounding explanatory prose or extra text
//   Malformed or partial JSON
//   JSON without required path and content string fields

function extractBareJsonProposal(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let candidate: string | null = null;

  // Case 1 — raw JSON object: entire response starts with { and ends with }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidate = trimmed;
  }

  // Case 2 — single fenced block (```json or ```): entire response is the fence
  if (candidate === null) {
    const fenceMatch = /^```(?:json)?\s*\r?\n([\s\S]+?)\r?\n[ \t]*```\s*$/.exec(trimmed);
    if (fenceMatch) {
      const inner = fenceMatch[1].trim();
      if (inner.startsWith("{") && inner.endsWith("}")) {
        candidate = inner;
      }
    }
  }

  if (candidate === null) return null;

  // Validate: must parse and have the required proposal shape
  let parsed: { path?: unknown; content?: unknown };
  try {
    parsed = JSON.parse(candidate) as { path?: unknown; content?: unknown };
  } catch {
    return null; // malformed or partial JSON
  }
  if (typeof parsed.path !== "string" || !parsed.path.trim()) return null;
  if (typeof parsed.content !== "string") return null;

  return candidate;
}

// Adapter: presents the ProposalExtract in the shape expected by
// parseProposalBlock() and detectAndPropose() (unchanged callers).
// Tries the marker-based extractor first, then the bare-JSON fallback.
function matchProposalBlock(
  text: string
): { fullMatch: string; index: number; jsonBody: string } | null {
  // Preferred path: marker-based extraction (jarvis-write-proposal)
  const extracted = extractWriteProposal(text);
  if (extracted) {
    return {
      index: extracted.blockStart,
      fullMatch: text.slice(extracted.blockStart, extracted.blockEnd),
      jsonBody: extracted.jsonBody,
    };
  }

  // Fallback path: bare JSON proposal when the model omitted the marker.
  // Only fires when the entire response is a single JSON object or fenced block.
  const bareJson = extractBareJsonProposal(text);
  if (!bareJson) return null;

  // Position the "block" to span the full trimmed content so that parseProposalBlock
  // computes empty before/after segments — there is no surrounding prose to display.
  const leadingSpace = text.length - text.trimStart().length;
  const trimmedContent = text.slice(leadingSpace).trimEnd();
  return {
    index: leadingSpace,
    fullMatch: trimmedContent,
    jsonBody: bareJson,
  };
}

interface ChatMessage {
  role: "user" | "assistant" | "error" | "cancelled";
  text: string;
}

// Shape expected by the API history field
interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

// Shape of a message row returned by GET /sessions/:id
interface BackendMessage {
  id: number;
  session_id: number;
  role: "user" | "assistant" | "error" | "cancelled";
  content: string;
  model: string | null;
  created_at: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// localStorage key for chat history
const STORAGE_KEY = "jarvis.chat.v1";
// localStorage key for the active backend session id
const SESSION_STORAGE_KEY = "jarvis.session.v1";
// localStorage key for the preferred voice/speech language
const VOICE_LANG_KEY = "jarvis.voice.lang.v1";
// localStorage key for the preferred SpeechSynthesis voice (by voice name)
const VOICE_NAME_KEY = "jarvis.voice.name.v1";

// Supported speech languages — used for both SpeechRecognition.lang and SpeechSynthesisUtterance.lang.
// Keep in sync with the <select> options in the voice bar JSX below.
const VOICE_LANG_OPTIONS: { value: string; label: string }[] = [
  { value: "sv-SE", label: "Swedish (sv-SE)" },
  { value: "en-US", label: "English (en-US)" },
];
const VOICE_LANG_DEFAULT = "sv-SE";

// Preview phrases spoken by the "Test voice" button — one per supported language.
const VOICE_PREVIEW_PHRASES: Record<string, string> = {
  "en-US": "Hello Jimmy. Jarvis voice preview.",
  "sv-SE": "Hej Jimmy. Detta är en röstförhandsvisning.",
};

// localStorage key for the selected TTS provider.
const VOICE_PROVIDER_KEY = "jarvis.voice.provider.v1";

// Valid TTS provider identifiers.
// "browser"  — web SpeechSynthesis API (default, always available)
// "local"    — planned: local TTS server such as Kokoro or Piper (not yet active)
type TtsProvider = "browser" | "local";
const TTS_PROVIDER_OPTIONS: { value: TtsProvider; label: string }[] = [
  { value: "browser", label: "Browser voice" },
  { value: "local",   label: "Local TTS (planned)" },
];
const TTS_PROVIDER_DEFAULT: TtsProvider = "browser";

const DEFAULT_GREETING: ChatMessage = {
  role: "assistant",
  text: "Hello. I am Jarvis — your local AI assistant. Type a message below to get started.",
};

// Maximum number of history turns to send to the API
const HISTORY_LIMIT = 12;

// Read saved messages from localStorage.
// Returns null if localStorage is unavailable (SSR) or the stored value is invalid.
function loadMessages(): ChatMessage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as ChatMessage[];
  } catch {
    return null;
  }
}

// Persist messages to localStorage.
// Silent no-op in SSR or if storage is unavailable (e.g. private mode quota).
function saveMessages(messages: ChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // Storage quota exceeded or blocked — not fatal, just skip saving
  }
}

// Build the history array to send to the API from the current message list.
// Excludes:
//   - the default UI greeting (not a real model response)
//   - error bubbles
//   - cancelled bubbles
//   - empty assistant placeholders (mid-stream)
// Returns the last HISTORY_LIMIT valid user/assistant turns.
function buildHistory(messages: ChatMessage[]): HistoryMessage[] {
  return messages
    .filter((m) => m.text !== DEFAULT_GREETING.text)
    .filter((m) => m.role !== "error")
    .filter((m) => m.role !== "cancelled")
    .filter((m) => !(m.role === "assistant" && m.text === ""))
    .filter((m): m is ChatMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
    )
    .map((m) => ({ role: m.role, content: m.text }))
    .slice(-HISTORY_LIMIT);
}

// --- Backend session persistence helpers ---
// These are module-level functions so they can reference the module-level API_URL constant.

// Load the active backend session id from localStorage.
function loadSessionId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const id = parseInt(raw, 10);
    return isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

// Persist the active backend session id to localStorage.
function saveSessionId(id: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, String(id));
  } catch {
    // Storage quota exceeded — not fatal
  }
}

// Create a new backend session and return its id.
// Returns null if the backend is unreachable — callers degrade gracefully.
async function createSession(): Promise<number | null> {
  try {
    const res = await fetch(`${API_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Jarvis Chat" }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      session?: { id: number };
    };
    if (!data.ok || !data.session?.id) return null;
    saveSessionId(data.session.id);
    return data.session.id;
  } catch {
    return null;
  }
}

// Fire-and-forget: persist one message to the backend.
// Never throws — failures are logged as console.warn only.
async function persistMessage(
  sessionId: number,
  role: "user" | "assistant" | "error" | "cancelled",
  content: string,
  model?: string
): Promise<void> {
  try {
    await fetch(`${API_URL}/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content, model }),
    });
  } catch (err) {
    console.warn("[Jarvis] Failed to persist message to backend:", err);
  }
}

// Fire-and-forget: update session title via PATCH /sessions/:id.
// Used to auto-title a session from the first user message.
async function updateSessionTitle(
  sessionId: number,
  title: string
): Promise<void> {
  try {
    await fetch(`${API_URL}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  } catch {
    // Not critical — ignore silently
  }
}

// Load chat history from the backend for a given session.
// Returns the mapped messages on success, null if the backend is unreachable, the session
// is gone, or the session has no messages yet.
async function loadSessionFromBackend(
  sessionId: number
): Promise<ChatMessage[] | null> {
  try {
    const res = await fetch(`${API_URL}/sessions/${sessionId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      messages?: BackendMessage[];
    };
    if (!data.ok || !Array.isArray(data.messages)) return null;
    const msgs: ChatMessage[] = data.messages.map((m) => ({
      role: m.role,
      text: m.content,
    }));
    // Treat an empty message list the same as "nothing from backend"
    return msgs.length > 0 ? msgs : null;
  } catch (err) {
    console.warn("[Jarvis] Failed to load history from backend:", err);
    return null;
  }
}

export default function ChatPanel({
  onSessionUpdated,
  attachment,
  onClearAttachment,
  prefillInput,
  onConsumePrefill,
  onActivity,
  onOpenWorkspaceFile,
}: {
  // Called after a session title is successfully updated (e.g. auto-title after first message).
  // Parent uses this to refresh the session list without reloading the page.
  onSessionUpdated?: () => void;
  // File attached via WorkspacePanel — prepended to the next outgoing message.
  attachment?: { path: string; content: string; size: number } | null;
  // Called by ChatPanel immediately when it consumes the attachment in send().
  onClearAttachment?: () => void;
  // Suggested question set by "Ask Jarvis about this file". Applied once to the input field.
  prefillInput?: string | null;
  // Called after ChatPanel reads prefillInput so the parent can reset it to null.
  onConsumePrefill?: () => void;
  // Reports a named activity event to the parent for display in ActivityPanel.
  onActivity?: (text: string, type?: "info" | "write" | "error") => void;
  // Called when the user clicks "Open draft" after a successful write.
  // Parent (page.tsx) forwards the path to WorkspacePanel for navigation and preview.
  onOpenWorkspaceFile?: (relativePath: string) => void;
} = {}) {
  // Start with the greeting on every render (matches server-rendered HTML).
  // localStorage is loaded after mount in a useEffect below.
  // This two-phase pattern prevents Next.js hydration mismatches.
  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_GREETING]);
  const [input, setInput] = useState("");
  // loading: true from send until the stream ends (or errors or is cancelled)
  const [loading, setLoading] = useState(false);
  // streaming: true once the first token has arrived (thinking dots hidden, text visible)
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Holds the active AbortController so the Stop button can cancel it
  const abortControllerRef = useRef<AbortController | null>(null);
  // Holds the active backend session id once ensureSession resolves
  const sessionIdRef = useRef<number | null>(null);
  // Ref to the textarea so we can drive its height for auto-grow behaviour
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // "backend" = history loaded from SQLite; "local" = localStorage or default
  const [historySource, setHistorySource] = useState<
    "backend" | "local" | null
  >(null);

  // ── Chat-created write proposal state ────────────────────────────────────
  // A proposal is created when the assistant response contains a jarvis-write-proposal block.
  // Nothing is written until the user clicks "Approve write".
  const [chatProposal, setChatProposal] = useState<{
    id: string;
    path: string;
    operation: "edit" | "create";
    diff: DiffLine[];
    // Full proposed content — stored so it can be copied to clipboard after approval
    // without needing a second API read.
    content: string;
  } | null>(null);
  const [chatProposalLoading, setChatProposalLoading] = useState(false);
  const [chatProposalError, setChatProposalError] = useState<string | null>(null);
  const [chatApproveLoading, setChatApproveLoading] = useState(false);
  const [chatApproveError, setChatApproveError] = useState<string | null>(null);
  // true after a successful write — lets the user see confirmation before dismissing
  const [chatWriteSuccess, setChatWriteSuccess] = useState(false);
  // The relative path of the most recently approved write — used to show the
  // draft path and "Open draft" button in the success state.
  const [chatApprovedPath, setChatApprovedPath] = useState<string | null>(null);
  // The full content of the most recently approved write — used by "Copy draft content".
  const [chatApprovedContent, setChatApprovedContent] = useState<string | null>(null);
  // true for 2 s after a successful clipboard copy — shows "Copied" label.
  const [chatCopied, setChatCopied] = useState(false);
  // Set when the clipboard write fails — shown inline so the user can react.
  const [chatCopyError, setChatCopyError] = useState<string | null>(null);

  // ── Voice input state (Web Speech API) ───────────────────────────────────
  // Whether the browser supports SpeechRecognition — set after mount to avoid SSR mismatch.
  const [voiceSupported, setVoiceSupported] = useState(false);
  // true while the microphone is actively listening for speech.
  const [voiceListening, setVoiceListening] = useState(false);
  // Set when recognition fails or mic permission is denied.
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Holds the active SpeechRecognition instance so it can be stopped on demand.
  const recognitionRef = useRef<JarvisRecognition | null>(null);

  // ── Text-to-speech state (SpeechSynthesis API) ────────────────────────────
  // Whether the browser supports speechSynthesis — set after mount.
  const [ttsSupported, setTtsSupported] = useState(false);
  // User-controlled toggle — off by default, persists only within the session.
  const [speakReplies, setSpeakReplies] = useState(false);
  // true while speechSynthesis is currently speaking an utterance.
  const [speaking, setSpeaking] = useState(false);
  // Set when speechSynthesis.speak() fires an error event.
  const [speechError, setSpeechError] = useState<string | null>(null);
  // Ref that mirrors speakReplies — lets the async send() read the current
  // toggle value after a long streaming gap without capturing a stale closure.
  const speakRepliesRef = useRef(false);
  // Holds the pending setTimeout id from speakAssistantText so it can be
  // cancelled if stopVoice or a toggle-off arrives before the delay expires.
  const speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Selected speech language — used for both SpeechRecognition.lang and utterance.lang.
  // Initialized to the default; overwritten from localStorage after mount.
  const [speechLang, setSpeechLang] = useState<string>(VOICE_LANG_DEFAULT);
  // Ref mirrors speechLang so the setTimeout inside speakAssistantText always uses
  // the current value even when the user changes language mid-response.
  const speechLangRef = useRef<string>(VOICE_LANG_DEFAULT);
  // List of browser/system voices populated by getVoices() (may load asynchronously).
  const [availableVoices, setAvailableVoices] = useState<JarvisVoice[]>([]);
  // Name of the user-selected voice ("" = browser default).
  // Persisted to localStorage under VOICE_NAME_KEY.
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("");
  // Ref mirrors selectedVoiceName for use inside speakAssistantText setTimeout.
  const selectedVoiceNameRef = useRef<string>("");
  // Which TTS engine is selected — "browser" or "local" (planned).
  // Initialized to the default; overwritten from localStorage after mount.
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>(TTS_PROVIDER_DEFAULT);
  // Ref mirrors ttsProvider so the async speakAssistantText always reads the
  // current value even when it changes during a long streaming response.
  const ttsProviderRef = useRef<TtsProvider>(TTS_PROVIDER_DEFAULT);

  // Load chat history after mount — backend is preferred, localStorage is the fallback.
  // Must run after mount (not during render) to avoid server/client HTML mismatch.
  useEffect(() => {
    const existingId = loadSessionId();

    if (existingId !== null) {
      // Session id stored — try to restore from backend first.
      sessionIdRef.current = existingId;
      loadSessionFromBackend(existingId).then((backendMessages) => {
        if (backendMessages !== null) {
          // Backend has history — use it and sync to localStorage as cache.
          setMessages(backendMessages);
          saveMessages(backendMessages);
          setHistorySource("backend");
        } else {
          // Backend unavailable or session has no messages — fall back to localStorage.
          const saved = loadMessages();
          if (saved && saved.length > 0) {
            setMessages(saved);
          }
          setHistorySource("local");
        }
      });
    } else {
      // No session id yet — use localStorage for initial state, create session in background.
      const saved = loadMessages();
      if (saved && saved.length > 0) {
        setMessages(saved);
      }
      setHistorySource("local");
      createSession().then((id) => {
        sessionIdRef.current = id;
      });
    }
  }, []);

  // Persist to localStorage only when loading finishes, not on every token update.
  // This avoids dozens of writes per streaming response.
  useEffect(() => {
    if (!loading) {
      saveMessages(messages);
    }
  }, [loading, messages]);

  // Scroll to latest message whenever the list or loading state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Abort any in-flight streaming request when the component unmounts (e.g. session switch).
  // Also cancel any ongoing speech recognition or synthesis to avoid background audio.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      recognitionRef.current?.abort();
      if (speechTimerRef.current !== null) clearTimeout(speechTimerRef.current);
      if (typeof window !== "undefined")
        (window as unknown as JarvisWindow).speechSynthesis?.cancel();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect Web Speech API and SpeechSynthesis support after mount (SSR-safe).
  // Also restores the saved speech language and TTS provider from localStorage.
  // All window access goes through the JarvisWindow cast (see type shims at top of file).
  useEffect(() => {
    const jw = window as unknown as JarvisWindow;
    setVoiceSupported(!!(jw.SpeechRecognition ?? jw.webkitSpeechRecognition));
    setTtsSupported(!!jw.speechSynthesis);
    try {
      // Restore saved language — only accept known option values.
      const savedLang = localStorage.getItem(VOICE_LANG_KEY);
      if (savedLang && VOICE_LANG_OPTIONS.some((o) => o.value === savedLang)) {
        setSpeechLang(savedLang);
        speechLangRef.current = savedLang;
      }
      // Restore saved TTS provider — only accept known option values.
      const savedProvider = localStorage.getItem(VOICE_PROVIDER_KEY) as TtsProvider | null;
      if (savedProvider && TTS_PROVIDER_OPTIONS.some((o) => o.value === savedProvider)) {
        setTtsProvider(savedProvider);
        ttsProviderRef.current = savedProvider;
      }
    } catch {
      // localStorage unavailable — keep defaults
    }
  }, []);

  // Keep the ref in sync with the toggle state so the async send() always reads
  // the current value even when speakReplies changed during a long streaming gap.
  useEffect(() => {
    speakRepliesRef.current = speakReplies;
  }, [speakReplies]);

  // Keep speechLangRef in sync with the speechLang state so that
  // speakAssistantText (which runs inside a setTimeout) always reads the
  // current value.  localStorage writes happen only in the <select> onChange
  // handler below to avoid overwriting a saved value on first mount.
  useEffect(() => {
    speechLangRef.current = speechLang;
  }, [speechLang]);

  // Keep selectedVoiceNameRef in sync with the selectedVoiceName state.
  useEffect(() => {
    selectedVoiceNameRef.current = selectedVoiceName;
  }, [selectedVoiceName]);

  // Keep ttsProviderRef in sync with the ttsProvider state so that
  // speakAssistantText (inside a setTimeout) always reads the current value.
  // localStorage writes happen only in the <select> onChange handler.
  useEffect(() => {
    ttsProviderRef.current = ttsProvider;
  }, [ttsProvider]);

  // Load available browser/system voices and restore the saved voice preference.
  //
  // Browsers expose voices through speechSynthesis.getVoices().  Chrome/Edge load
  // the voice list asynchronously, so we must also listen for onvoiceschanged.
  // Firefox and some versions of Safari return voices synchronously.
  //
  // The saved voice name is validated against the loaded list — if it no longer
  // exists (e.g. the user uninstalled a voice pack) we fall back to the default.
  useEffect(() => {
    const jw = window as unknown as JarvisWindow;
    const ss = jw.speechSynthesis;
    if (!ss) return;

    let savedVoiceName = "";
    try {
      savedVoiceName = localStorage.getItem(VOICE_NAME_KEY) ?? "";
    } catch {
      // localStorage unavailable — keep empty (browser default)
    }

    function loadVoices(): void {
      const voices = ss!.getVoices();
      if (voices.length === 0) return; // not ready yet — wait for voiceschanged
      setAvailableVoices(voices);
      // Restore saved voice only if it is still present in the list
      if (savedVoiceName && voices.some((v) => v.name === savedVoiceName)) {
        setSelectedVoiceName(savedVoiceName);
        selectedVoiceNameRef.current = savedVoiceName;
      }
    }

    loadVoices(); // synchronous path (Firefox, some Safari versions)
    ss.onvoiceschanged = loadVoices; // async path (Chrome, Edge)

    return () => {
      ss.onvoiceschanged = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop speech playback immediately when the user turns off "Speak replies".
  useEffect(() => {
    if (!speakReplies && typeof window !== "undefined") {
      if (speechTimerRef.current !== null) {
        clearTimeout(speechTimerRef.current);
        speechTimerRef.current = null;
      }
      (window as unknown as JarvisWindow).speechSynthesis?.cancel();
      setSpeaking(false);
      setSpeechError(null);
    }
  }, [speakReplies]);

  // Apply a prefilled question from "Ask Jarvis about this file".
  // Runs once when prefillInput changes from null to a string, then the parent
  // resets it to null via onConsumePrefill so it cannot fire twice.
  useEffect(() => {
    if (prefillInput) {
      setInput(prefillInput);
      onConsumePrefill?.();
    }
  }, [prefillInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearChat = () => {
    if (!window.confirm("Clear all chat history? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    setMessages([DEFAULT_GREETING]);
  };

  // Cancel the active streaming request. Partial text is preserved.
  const cancel = () => {
    abortControllerRef.current?.abort();
  };

  // ── Chat write proposal handlers ──────────────────────────────────────────

  // Called after streaming ends. Scans the full response text for a
  // jarvis-write-proposal fenced block and, if found, calls POST /files/propose-write.
  // On success the diff is stored in chatProposal and shown in the UI.
  // Nothing is written to disk here — the user must click "Approve write".
  async function detectAndPropose(text: string): Promise<void> {
    const result = matchProposalBlock(text);
    if (!result) return;

    // Distinguish in the activity log whether the preferred marker path or the bare-JSON fallback fired
    const isBareJsonFallback = !text.includes("jarvis-write-proposal");
    onActivity?.(
      isBareJsonFallback
        ? "Chat write proposal detected (bare JSON fallback) — creating proposal…"
        : "Chat write proposal detected — creating proposal…",
      "info"
    );
    setChatProposalLoading(true);
    setChatProposalError(null);
    setChatWriteSuccess(false);

    let parsed: { path?: unknown; content?: unknown };
    try {
      parsed = JSON.parse(result.jsonBody) as { path?: unknown; content?: unknown };
    } catch {
      const errMsg = "Failed to parse write proposal JSON from assistant response.";
      setChatProposalError(errMsg);
      setChatProposalLoading(false);
      onActivity?.(`Chat write proposal parse error: ${errMsg}`, "error");
      return;
    }

    const proposalPath =
      typeof parsed.path === "string" ? parsed.path.trim() : "";
    const proposalContent =
      typeof parsed.content === "string" ? parsed.content : null;

    if (!proposalPath || proposalContent === null) {
      const errMsg =
        "Write proposal from chat is missing required path or content fields.";
      setChatProposalError(errMsg);
      setChatProposalLoading(false);
      onActivity?.(`Chat write proposal invalid: ${errMsg}`, "error");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/files/propose-write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: proposalPath, content: proposalContent }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        id?: string;
        path?: string;
        operation?: "edit" | "create";
        diff?: DiffLine[];
        error?: string;
      };
      if (!data.ok || !data.id || !data.diff) {
        const errMsg = data.error ?? "Backend rejected the write proposal.";
        setChatProposalError(errMsg);
        onActivity?.(
          `Chat write proposal failed for ${proposalPath}: ${errMsg}`,
          "error"
        );
        return;
      }
      setChatProposal({
        id: data.id,
        path: data.path ?? proposalPath,
        operation: data.operation ?? "edit",
        diff: data.diff,
        content: proposalContent,
      });
      onActivity?.(
        `Chat write proposal created for workspace/${proposalPath}`,
        "write"
      );
    } catch {
      const errMsg = "API unreachable — is the Jarvis API running?";
      setChatProposalError(errMsg);
      onActivity?.(
        `Chat write proposal failed for ${proposalPath}: ${errMsg}`,
        "error"
      );
    } finally {
      setChatProposalLoading(false);
    }
  }

  async function handleChatApprove(): Promise<void> {
    if (!chatProposal) return;
    setChatApproveLoading(true);
    setChatApproveError(null);

    try {
      const res = await fetch(`${API_URL}/files/approve-write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: chatProposal.id }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        path?: string;
        written?: boolean;
        error?: string;
      };
      if (!data.ok) {
        const errMsg = data.error ?? "Failed to approve write.";
        setChatApproveError(errMsg);
        onActivity?.(
          `Chat write approval failed for ${chatProposal.path}: ${errMsg}`,
          "error"
        );
        return;
      }
      onActivity?.(
        `Chat write approved and applied to workspace/${chatProposal.path}`,
        "write"
      );
      const approvedPath = chatProposal.path;
      const approvedContent = chatProposal.content;
      setChatProposal(null);
      setChatWriteSuccess(true);
      setChatApprovedPath(approvedPath);
      setChatApprovedContent(approvedContent);
      setChatCopied(false);
      setChatCopyError(null);
    } catch {
      const errMsg = "API unreachable — is the Jarvis API running?";
      setChatApproveError(errMsg);
      onActivity?.(
        `Chat write approval failed: ${errMsg}`,
        "error"
      );
    } finally {
      setChatApproveLoading(false);
    }
  }

  function handleChatCancelProposal(): void {
    const cancelledPath = chatProposal?.path;
    setChatProposal(null);
    setChatProposalError(null);
    setChatApproveError(null);
    if (cancelledPath) {
      onActivity?.(
        `Chat write proposal cancelled for workspace/${cancelledPath}`,
        "write"
      );
    }
  }

  // Copy the approved draft content to the clipboard.
  // Only callable when chatApprovedContent is set (draft success state).
  // Failures are shown inline; the banner remains visible so the user can retry.
  async function handleCopyDraft(): Promise<void> {
    if (!chatApprovedContent) return;
    try {
      await navigator.clipboard.writeText(chatApprovedContent);
      setChatCopied(true);
      setChatCopyError(null);
      onActivity?.("Draft content copied to clipboard", "info");
      // Auto-reset the "Copied" label after 2 seconds
      setTimeout(() => setChatCopied(false), 2000);
    } catch {
      setChatCopyError("Could not copy — try opening the draft and copying manually.");
    }
  }

  // Start or stop microphone voice input using the browser Web Speech API.
  // Recognized speech is appended to the chat input; nothing is sent automatically.
  // Microphone is only active while the user has the session open and clicked this button.
  function toggleVoiceInput(): void {
    // If currently listening, stop recognition
    if (voiceListening) {
      recognitionRef.current?.stop();
      return;
    }

    // Check support at call time (voiceSupported state covers the common case, but
    // the runtime check is the real guard since this runs in the browser).
    // All window access goes through the JarvisWindow cast (see type shims above).
    const jw = window as unknown as JarvisWindow;
    const SpeechRecognitionCtor: JarvisRecognitionCtor | undefined =
      jw.SpeechRecognition ?? jw.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceError("Voice input is not supported in this browser.");
      return;
    }

    setVoiceError(null);

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;    // Stop after the first utterance
    recognition.interimResults = false; // Only final results
    recognition.lang = speechLang;     // User-selected language

    recognition.onstart = () => {
      setVoiceListening(true);
    };

    recognition.onresult = (event: JarvisRecognitionEvent) => {
      if (event.results.length > 0 && event.results[0].length > 0) {
        const transcript = event.results[0][0].transcript.trim();
        if (transcript) {
          // Append to existing input (or replace if empty)
          setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
          // Sync textarea height to the new content
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(
              textareaRef.current.scrollHeight,
              200
            )}px`;
          }
        }
      }
    };

    recognition.onerror = (event: JarvisRecognitionErrorEvent) => {
      if (event.error === "not-allowed") {
        setVoiceError("Microphone permission denied.");
      } else if (event.error === "no-speech") {
        // No speech was detected — clear any previous error, just end quietly
        setVoiceError(null);
      } else if (event.error === "aborted") {
        // User-initiated stop — not an error
        setVoiceError(null);
      } else {
        setVoiceError(`Voice recognition error: ${event.error}`);
      }
      setVoiceListening(false);
    };

    recognition.onend = () => {
      setVoiceListening(false);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setVoiceError("Failed to start voice recognition.");
      setVoiceListening(false);
    }
  }

  // ── TTS provider implementations ─────────────────────────────────────────────

  // Browser TTS implementation — wraps the Web SpeechSynthesis API.
  //
  // Chrome/Edge bugs addressed here:
  //
  // 1. cancel() + immediate speak() race — calling cancel() followed by speak()
  //    without a delay silently drops the utterance when the queue was non-empty.
  //    Fixed with a 150 ms setTimeout.
  //
  // 2. Engine paused after first utterance (crbug/671211) — after any utterance
  //    finishes naturally, Chrome sets speechSynthesis.paused = true and will not
  //    play subsequent utterances.  Fixed by calling resume() before speak() when
  //    the engine reports itself as paused.
  //
  // 3. Stale closure on speakReplies toggle — the delay re-checks speakRepliesRef
  //    so a toggle-off during the 150 ms window correctly cancels the speak.
  function speakWithBrowserTts(text: string): void {
    const jw = window as unknown as JarvisWindow;
    if (!jw.speechSynthesis || !jw.SpeechSynthesisUtterance) return;

    // Cancel any pending timer from a previous call so we do not double-speak.
    if (speechTimerRef.current !== null) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }

    setSpeechError(null);
    jw.speechSynthesis.cancel();

    // Delay lets the synthesis queue flush before we speak (Chrome bug #1 workaround).
    speechTimerRef.current = setTimeout(() => {
      speechTimerRef.current = null;
      if (!speakRepliesRef.current) return; // user toggled off during the delay
      const jwLate = window as unknown as JarvisWindow;
      if (!jwLate.speechSynthesis || !jwLate.SpeechSynthesisUtterance) return;

      // Resume the engine if it paused after the previous utterance ended
      // (Chrome bug #2 workaround — engine stays paused after onend fires).
      if (jwLate.speechSynthesis.paused) {
        jwLate.speechSynthesis.resume();
      }

      const utterance = new jwLate.SpeechSynthesisUtterance(text);
      utterance.lang = speechLangRef.current; // user-selected language, always current via ref
      // Apply the user-selected voice if one is saved and still available.
      // Always look up from getVoices() at speak time — the list can change between
      // responses (e.g. OS voice packs installed/removed).
      const currentVoices = jwLate.speechSynthesis.getVoices();
      utterance.voice = selectedVoiceNameRef.current
        ? currentVoices.find((v) => v.name === selectedVoiceNameRef.current) ?? null
        : null;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => {
        setSpeaking(false);
        setSpeechError("Voice playback failed — check browser permissions.");
      };
      jwLate.speechSynthesis.speak(utterance);
    }, 150);
  }

  // Local TTS placeholder — will route to a local TTS server (Kokoro / Piper) in a future milestone.
  // For now it surfaces a helpful error so the user knows to switch back to "Browser voice".
  function speakWithLocalTts(): void {
    setSpeechError(
      "Local TTS is not configured yet. Switch to Browser voice in the TTS dropdown to hear replies."
    );
  }

  // Route TTS to the currently selected provider.
  // All call sites use this function — provider switching is transparent to callers.
  function speakAssistantText(text: string): void {
    if (typeof window === "undefined") return;
    if (!text.trim()) return;
    if (ttsProviderRef.current === "local") {
      speakWithLocalTts();
      return;
    }
    speakWithBrowserTts(text);
  }

  // Cancel any in-progress speech and reset the speaking state.
  // Also clears any pending speech timer so a queued utterance does not play after the stop.
  function stopVoice(): void {
    if (speechTimerRef.current !== null) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    if (typeof window === "undefined") return;
    (window as unknown as JarvisWindow).speechSynthesis?.cancel();
    setSpeaking(false);
    setSpeechError(null);
  }

  // Speak a short preview phrase using the currently selected language and voice.
  // Lets the user audition voices without sending a chat message.
  // Uses the same cancel/delay/resume pattern as speakWithBrowserTts; does NOT
  // check speakRepliesRef — this is an explicit user action, not an auto-reply.
  // When the local TTS provider is selected the preview is not available and
  // an informational message is shown instead.
  function speakPreview(): void {
    if (typeof window === "undefined") return;
    if (ttsProvider === "local") {
      setSpeechError(
        "Voice preview is not available for Local TTS. Switch to Browser voice to audition voices."
      );
      return;
    }
    const jw = window as unknown as JarvisWindow;
    if (!jw.speechSynthesis || !jw.SpeechSynthesisUtterance) return;

    // Pick the preview phrase for the currently selected language.
    // speechLang is read directly (click handler — closure is always fresh).
    const phrase =
      VOICE_PREVIEW_PHRASES[speechLang] ??
      VOICE_PREVIEW_PHRASES["en-US"] ??
      "Jarvis voice preview.";

    // Cancel any pending timer or ongoing speech before starting the preview.
    if (speechTimerRef.current !== null) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    setSpeechError(null);
    jw.speechSynthesis.cancel();

    speechTimerRef.current = setTimeout(() => {
      speechTimerRef.current = null;
      const jwLate = window as unknown as JarvisWindow;
      if (!jwLate.speechSynthesis || !jwLate.SpeechSynthesisUtterance) return;
      if (jwLate.speechSynthesis.paused) jwLate.speechSynthesis.resume();

      const voices = jwLate.speechSynthesis.getVoices();
      const voice = selectedVoiceNameRef.current
        ? voices.find((v) => v.name === selectedVoiceNameRef.current) ?? null
        : null;

      const utterance = new jwLate.SpeechSynthesisUtterance(phrase);
      utterance.lang = speechLangRef.current;
      utterance.voice = voice;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => {
        setSpeaking(false);
        setSpeechError("Voice preview failed — check browser permissions.");
      };
      jwLate.speechSynthesis.speak(utterance);
    }, 150);
  }

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    // Clear any previous chat-created write proposal so the next response starts fresh
    setChatProposal(null);
    setChatProposalError(null);
    setChatApproveError(null);
    setChatWriteSuccess(false);
    setChatApprovedPath(null);
    setChatApprovedContent(null);
    setChatCopied(false);
    setChatCopyError(null);
    setSpeechError(null);

    // Snapshot and immediately clear the attachment so it cannot be sent twice
    const attachmentSnapshot = attachment ?? null;
    onClearAttachment?.();

    // Capture history from current messages before the new user turn is added
    const history = buildHistory(messages);
    // Detect first user message so we can auto-title the session afterwards
    const isFirstUserMessage = !messages.some((m) => m.role === "user");

    // Build the text shown in the UI bubble — typed message plus a small attachment label
    const bubbleText = attachmentSnapshot
      ? `${trimmed}\n\n[Attached: ${attachmentSnapshot.path}]`
      : trimmed;

    // Build the API message — includes file content in a fenced block when a file is attached
    const fence = "```";
    const apiMessage = attachmentSnapshot
      ? `The user attached the following read-only workspace file:\n\nFile: ${attachmentSnapshot.path}\n\n${fence}\n${attachmentSnapshot.content}\n${fence}\n\n${trimmed}`
      : trimmed;

    // Show user message immediately (bubble shows typed text + attachment label, not file content)
    setMessages((prev) => [...prev, { role: "user", text: bubbleText }]);
    setInput("");
    setLoading(true);
    setStreaming(false);

    // Create a fresh AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Snapshot the session id before any await so it stays consistent for this send
    const sid = sessionIdRef.current;
    // Persist the composed API message (includes file content) and auto-title if first message
    if (sid !== null) {
      void persistMessage(sid, "user", apiMessage);
      if (isFirstUserMessage) {
        void updateSessionTitle(sid, trimmed.slice(0, 50)).then(() => {
          onSessionUpdated?.();
        });
      }
    }

    // Track accumulated assistant text and model locally for persistence after streaming
    let assistantText = "";
    let modelName: string | undefined;

    try {
      const res = await fetch(`${API_URL}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: apiMessage, history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`API returned HTTP ${res.status}`);
      }

      // Add an empty assistant bubble — we'll fill it in as tokens arrive
      setMessages((prev) => [...prev, { role: "assistant", text: "" }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let errorText: string | null = null;
      // Local flag avoids relying on stale closure value of `streaming` state
      let firstTokenReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Each chunk from the API is one JSON line terminated with \n
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const chunk = JSON.parse(line) as
            | { type: "token"; content: string }
            | { type: "done"; model: string }
            | { type: "error"; error: string };

          if (chunk.type === "token") {
            // Switch from thinking dots to growing text bubble on the first token
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              setStreaming(true);
            }

            // Accumulate text locally so we can persist the full response later
            assistantText += chunk.content;
            // Append token to the last message in-place
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              updated[updated.length - 1] = {
                ...last,
                text: last.text + chunk.content,
              };
              return updated;
            });
          } else if (chunk.type === "error") {
            errorText = chunk.error;
          } else if (chunk.type === "done") {
            // Capture model name so we can include it when persisting the assistant message
            modelName = chunk.model;
          }
        }
      }

      // If Ollama reported an error mid-stream, replace the empty bubble with an error
      if (errorText) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant" && last.text === "") {
            updated[updated.length - 1] = { role: "error", text: errorText! };
          }
          return updated;
        });
        // Persist error bubble
        if (sid !== null) {
          void persistMessage(sid, "error", errorText);
        }
      } else if (assistantText) {
        // Persist successful assistant response with model name if known
        if (sid !== null) void persistMessage(sid, "assistant", assistantText, modelName);
        // Scan for a jarvis-write-proposal block and create a pending proposal if found
        void detectAndPropose(assistantText);
        // Speak the response when the user has voice replies enabled.
        // Uses speakRepliesRef (not the closure-captured speakReplies state) so that
        // a toggle-off during a long streaming response is respected.
        // Proposal responses are replaced with a short safe summary so raw JSON is
        // never read aloud.
        if (speakRepliesRef.current) {
          const proposalMatch = matchProposalBlock(assistantText);
          const textToSpeak = proposalMatch
            ? "Jarvis proposed a workspace file change. Review it before approving."
            : assistantText;
          speakAssistantText(textToSpeak);
        }
      }
    } catch (err: unknown) {
      // User-initiated abort — not an error
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          // Only replace the bubble if no text arrived yet — otherwise keep partial text
          if (last.role === "assistant" && last.text === "") {
            updated[updated.length - 1] = {
              role: "cancelled",
              text: "Response cancelled.",
            };
          }
          return updated;
        });
        // Persist partial text if tokens arrived, otherwise the cancelled marker
        if (sid !== null) {
          if (assistantText) {
            void persistMessage(sid, "assistant", assistantText, modelName);
          } else {
            void persistMessage(sid, "cancelled", "Response cancelled.");
          }
        }
        return;
      }

      // Real network or API error — show error bubble
      const msg =
        err instanceof Error
          ? err.message
          : "Could not reach the Jarvis API. Is it running on port 4000?";

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        // If the empty assistant bubble was already added, convert it to an error
        if (last.role === "assistant" && last.text === "") {
          updated[updated.length - 1] = { role: "error", text: msg };
        } else {
          updated.push({ role: "error", text: msg });
        }
        return updated;
      });
      // Persist error message
      if (sid !== null) {
        void persistMessage(sid, "error", msg);
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setStreaming(false);
    }
  };

  // Auto-grow the textarea to fit its content, capped at 200px.
  // When the user clears the input (e.g. after send), height resets to minHeight via CSS.
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }

  // Reset textarea height when the input value is cleared programmatically (post-send).
  useEffect(() => {
    if (input === "" && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  // Allow Shift+Enter for newlines; Enter alone submits
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(e as unknown as FormEvent);
    }
  };

  // Show thinking dots only while loading and before the first token arrives
  const showThinking = loading && !streaming;

  // Context count shown in the header — computed from the current message list
  const contextCount = buildHistory(messages).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Chat</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Streaming · Ollama ·{" "}
            <span className="text-slate-600">
              context: {contextCount} msg{contextCount !== 1 ? "s" : ""}
            </span>
            {historySource && (
              <span className="text-slate-700">
                {" · "}history: {historySource}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={clearChat}
          disabled={loading}
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Clear chat history"
        >
          Clear chat
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, i) => {
          if (msg.role === "user") return <UserMessage key={i} text={msg.text} />;
          if (msg.role === "error") return <ErrorMessage key={i} text={msg.text} />;
          if (msg.role === "cancelled") return <CancelledMessage key={i} />;
          // Show a blinking cursor on the last assistant message while streaming
          const isLast = i === messages.length - 1;
          return (
            <AssistantMessage
              key={i}
              text={msg.text}
              showCursor={streaming && isLast}
            />
          );
        })}

        {/* Thinking indicator — visible from send until the first token arrives */}
        {showThinking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0 text-cyan-400 text-xs font-bold">
              J
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60 px-4 py-3">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Chat write proposal banner — shown when the assistant response contained a proposal block */}
      {(chatProposal || chatProposalLoading || chatProposalError || chatWriteSuccess) && (
        <div className="flex-shrink-0 border-t border-amber-500/20 bg-amber-900/10">
          {/* Banner header */}
          <div className="flex items-center justify-between px-6 py-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-widest">
                {chatWriteSuccess ? "Write applied" : "Pending write approval"}
              </p>
              {/* Email draft badge — visible while a drafts/ proposal is pending */}
              {chatProposal?.path.startsWith("drafts/") && (
                <span className="text-xs px-1.5 py-px rounded bg-cyan-500/10 text-cyan-500/80 border border-cyan-500/20 font-medium">
                  email draft
                </span>
              )}
            </div>
            {(chatWriteSuccess || chatProposalError) && (
              <button
                onClick={() => {
                  setChatProposal(null);
                  setChatProposalError(null);
                  setChatApproveError(null);
                  setChatWriteSuccess(false);
                  setChatApprovedPath(null);
                  setChatApprovedContent(null);
                  setChatCopied(false);
                  setChatCopyError(null);
                }}
                className="text-slate-600 hover:text-slate-400 text-sm leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            )}
          </div>

          {chatProposalLoading && (
            <p className="px-6 pb-3 text-xs text-slate-600">
              Creating proposal from assistant response…
            </p>
          )}

          {chatProposalError && (
            <p className="px-6 pb-3 text-xs text-red-500/70">{chatProposalError}</p>
          )}

          {chatWriteSuccess && (
            <div className="px-6 pb-3 space-y-1.5">
              {chatApprovedPath?.startsWith("drafts/") ? (
                <>
                  <p className="text-xs text-green-400">
                    ✓ Draft created:{" "}
                    <span className="font-mono text-green-500">
                      workspace/{chatApprovedPath}
                    </span>
                  </p>
                  <button
                    onClick={() => onOpenWorkspaceFile?.(chatApprovedPath)}
                    className="w-full text-xs py-1.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                  >
                    Open draft in Workspace Files
                  </button>
                  {/* Copy draft content — clipboard write; shows 2 s "Copied" on success */}
                  {chatCopied ? (
                    <p className="text-xs text-green-400 text-center">
                      ✓ Copied to clipboard
                    </p>
                  ) : chatCopyError ? (
                    <p className="text-xs text-red-500/70 text-center">
                      {chatCopyError}
                    </p>
                  ) : (
                    <button
                      onClick={() => void handleCopyDraft()}
                      className="w-full text-xs py-1.5 rounded bg-slate-700/40 text-slate-400 border border-slate-600/30 hover:bg-slate-700/60 hover:text-slate-200 transition-colors"
                    >
                      Copy draft content
                    </button>
                  )}
                </>
              ) : (
                <p className="text-xs text-green-400">
                  ✓ File written successfully. Open the Workspace panel to see the updated content.
                </p>
              )}
            </div>
          )}

          {chatProposal && (
            <>
              <div className="px-6 pb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-amber-700">
                    Target:{" "}
                    <span className="text-amber-500 font-mono">
                      workspace/{chatProposal.path}
                    </span>
                  </p>
                  {/* New-file badge — only for create proposals */}
                  {chatProposal.operation === "create" && (
                    <span className="text-xs px-1.5 py-px rounded bg-slate-700/60 text-slate-400 border border-slate-600/40 font-medium">
                      new file
                    </span>
                  )}
                </div>
                <p className="text-xs text-amber-800 mt-0.5">
                  {chatProposal.operation === "create"
                    ? "File will be created after approval. Nothing written yet."
                    : "Nothing has been written yet."}
                </p>
              </div>

              {/* Diff viewer */}
              <div className="mx-6 mb-2 rounded border border-slate-700/60 overflow-hidden">
                {/* Header — file path */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 border-b border-slate-700/60 select-none">
                  <span className="text-slate-600 text-xs font-mono">diff</span>
                  <span className="text-amber-500/80 font-mono text-xs truncate">
                    workspace/{chatProposal.path}
                  </span>
                </div>

                {/* Scrollable diff lines */}
                <div className="overflow-y-auto" style={{ maxHeight: "190px" }}>
                  {getDisplayLines(chatProposal.diff).map((line, i) => {
                    if (line.type === "gap") {
                      return (
                        <div
                          key={i}
                          className="pl-2 pr-3 py-0.5 text-xs text-slate-600 bg-slate-800/40 text-center select-none border-l-2 border-transparent"
                        >
                          ··· {line.count} unchanged line{line.count !== 1 ? "s" : ""} ···
                        </div>
                      );
                    }
                    // Each line gets a 2px left border for visual scanning.
                    // Context lines use a transparent border so content stays aligned.
                    const rowClass =
                      line.type === "added"
                        ? "bg-green-900/25 border-l-2 border-green-600 text-green-300"
                        : line.type === "removed"
                        ? "bg-red-900/20 border-l-2 border-red-700 text-red-300"
                        : "border-l-2 border-transparent text-slate-400";
                    const prefix =
                      line.type === "added" ? "+" : line.type === "removed" ? "−" : " ";
                    return (
                      <div
                        key={i}
                        className={`flex gap-2 pl-2 pr-3 py-0.5 font-mono text-xs leading-relaxed ${rowClass}`}
                      >
                        <span className="flex-shrink-0 select-none w-3">{prefix}</span>
                        <span className="whitespace-pre-wrap break-all">{line.content}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Approve / Cancel */}
              <div className="px-6 pb-3 space-y-1.5">
                {chatApproveError && (
                  <p className="text-xs text-red-500/70 text-center">
                    {chatApproveError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleChatApprove()}
                    disabled={chatApproveLoading}
                    className="flex-1 text-xs py-1.5 rounded bg-green-900/20 text-green-400 border border-green-500/20 hover:bg-green-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {chatApproveLoading ? "Writing…" : "Approve write"}
                  </button>
                  <button
                    onClick={handleChatCancelProposal}
                    disabled={chatApproveLoading}
                    className="flex-1 text-xs py-1.5 rounded bg-slate-700/40 text-slate-400 border border-slate-600/30 hover:bg-slate-700/60 hover:text-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={send} className="px-6 py-4 border-t border-slate-800">
        {/* Attachment pill — shown when a workspace file is queued for the next message */}
        {attachment && (
          <div className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs">
            <span className="text-cyan-400 truncate">
              Attached: <span className="font-medium">{attachment.path}</span>
              <span className="text-cyan-600 ml-1">· Read-only · will be included in next message</span>
            </span>
            <button
              type="button"
              onClick={onClearAttachment}
              className="flex-shrink-0 text-cyan-700 hover:text-cyan-400 leading-none"
              aria-label="Remove attachment"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={loading ? "Jarvis is responding…" : "Message Jarvis…"}
            disabled={loading}
            style={{ minHeight: "72px", maxHeight: "200px", overflowY: "auto" }}
            className="flex-1 resize-none rounded-lg bg-slate-800/60 border border-slate-700 px-4 py-3 text-sm text-slate-200 leading-relaxed placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          />

          {/* Mic button — activates browser speech recognition; fills the chat input with
              recognized speech.  Never sends automatically.  Hidden while a response is
              streaming (the input is disabled then, so voice input is irrelevant). */}
          {!loading && (
            <button
              type="button"
              onClick={toggleVoiceInput}
              aria-label={voiceListening ? "Stop listening" : "Voice input"}
              title={
                !voiceSupported
                  ? "Voice input is not supported in this browser"
                  : voiceListening
                  ? "Stop listening"
                  : "Voice input"
              }
              className={`flex-shrink-0 px-3 py-3 rounded-lg text-sm border transition-colors ${
                voiceListening
                  ? "bg-red-500/20 text-red-400 border-red-500/30 animate-pulse"
                  : voiceSupported
                  ? "bg-slate-700/40 text-slate-500 border-slate-600/30 hover:bg-slate-700/60 hover:text-slate-300"
                  : "bg-slate-800/40 text-slate-700 border-slate-700/30 cursor-not-allowed"
              }`}
            >
              {voiceListening ? "■" : "Mic"}
            </button>
          )}

          {/* Stop button — always rendered to prevent layout shift; invisible when idle */}
          <button
            type="button"
            onClick={cancel}
            aria-label="Stop response"
            className={`px-4 py-3 rounded-lg text-sm font-medium border transition-colors
              ${
                loading
                  ? "bg-slate-700/60 text-slate-300 border-slate-600/60 hover:bg-slate-700 hover:text-slate-100"
                  : "invisible pointer-events-none"
              }`}
          >
            Stop
          </button>

          <button
            type="submit"
            disabled={loading || input.trim() === ""}
            className="px-4 py-3 rounded-lg bg-cyan-500/20 text-cyan-400 text-sm font-medium border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-slate-700">
            Enter to send · Shift+Enter for new line
          </p>
        </div>

        {/* Voice bar — only shown when the browser supports at least one voice API.
            Row 0: TTS provider selector (browser vs local)
            Row 1: speech language + TTS toggle / speaking status
            Row 2: voice selector + Test voice button (TTS only)
            Row 3: status messages */}
        {(voiceSupported || ttsSupported) && (
          <div className="mt-2 pt-2 border-t border-slate-800/60 space-y-1.5">

            {/* Row 0: TTS provider — only shown when TTS is supported */}
            {ttsSupported && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-700">TTS:</span>
                <select
                  value={ttsProvider}
                  onChange={(e) => {
                    const provider = e.target.value as TtsProvider;
                    setTtsProvider(provider);
                    // Write immediately in the handler — do not use a useEffect that
                    // would fire on first mount and overwrite the saved preference.
                    ttsProviderRef.current = provider;
                    try { localStorage.setItem(VOICE_PROVIDER_KEY, provider); } catch {}
                    // Clear any lingering provider-related error on switch
                    setSpeechError(null);
                  }}
                  title="Text-to-speech engine"
                  className="text-xs bg-slate-800/60 border border-slate-700/60 text-slate-400 rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/40 cursor-pointer"
                >
                  {TTS_PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {/* Planned badge — visible when "Local TTS" is selected to make clear it is not yet active */}
                {ttsProvider === "local" && (
                  <span className="text-xs text-amber-700/70 italic">not yet active</span>
                )}
              </div>
            )}

            {/* Row 1: language + TTS toggle */}
            <div className="flex items-center justify-between gap-3">
              {/* Left: speech language selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-700">Speech:</span>
                <select
                  value={speechLang}
                  onChange={(e) => {
                    const lang = e.target.value;
                    setSpeechLang(lang);
                    // Write immediately — do not rely on a useEffect that would also
                    // fire on first mount and overwrite the previously saved value.
                    speechLangRef.current = lang;
                    try { localStorage.setItem(VOICE_LANG_KEY, lang); } catch {}
                  }}
                  title="Speech language for microphone input and voice replies"
                  className="text-xs bg-slate-800/60 border border-slate-700/60 text-slate-400 rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/40 cursor-pointer"
                >
                  {VOICE_LANG_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Right: TTS toggle or speaking status */}
              {ttsSupported && (
                <div className="flex items-center gap-2">
                  {speaking ? (
                    <>
                      <span className="text-xs text-cyan-600/70 animate-pulse">
                        Speaking…
                      </span>
                      <button
                        type="button"
                        onClick={stopVoice}
                        className="text-xs text-slate-500 hover:text-slate-300 border border-slate-600/40 rounded px-2 py-0.5 hover:border-slate-500/60 transition-colors"
                      >
                        Stop voice
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSpeakReplies((v) => !v)}
                      title={speakReplies ? "Disable voice replies" : "Enable voice replies"}
                      className={`text-xs transition-colors ${
                        speakReplies
                          ? "text-cyan-500/80 hover:text-cyan-400"
                          : "text-slate-700 hover:text-slate-500"
                      }`}
                    >
                      Voice replies: {speakReplies ? "on" : "off"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Row 2: voice selector + Test voice button (only when TTS is available) */}
            {ttsSupported && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-slate-700 flex-shrink-0">Voice:</span>
                  <select
                    value={selectedVoiceName}
                    onChange={(e) => {
                      const name = e.target.value;
                      setSelectedVoiceName(name);
                      selectedVoiceNameRef.current = name;
                      try { localStorage.setItem(VOICE_NAME_KEY, name); } catch {}
                    }}
                    title="Browser/system voice for TTS replies"
                    className="text-xs bg-slate-800/60 border border-slate-700/60 text-slate-400 rounded px-1.5 py-0.5 min-w-0 max-w-[150px] focus:outline-none focus:border-cyan-500/40 cursor-pointer"
                  >
                    <option value="">Browser default</option>
                    {availableVoices.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Test voice: speaks a short preview phrase to audition the selected voice */}
                <button
                  type="button"
                  onClick={speakPreview}
                  title="Speak a short phrase to preview the selected voice"
                  className="flex-shrink-0 text-xs text-slate-700 hover:text-slate-400 border border-slate-700/40 rounded px-2 py-0.5 hover:border-slate-600/60 transition-colors"
                >
                  Test voice
                </button>
              </div>
            )}

            {/* Row 3: status messages — mic listening / voice errors / speech errors */}
            {voiceListening && (
              <p className="text-xs text-red-400 text-center animate-pulse">
                Listening…
              </p>
            )}
            {!voiceListening && voiceError && (
              <p className="text-xs text-red-500/70 text-center">{voiceError}</p>
            )}
            {!speaking && speechError && (
              <p className="text-xs text-red-500/70 text-center">{speechError}</p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

// Split an assistant message into segments around a jarvis-write-proposal block.
// Returns { before, proposalPath, after } so AssistantMessage can render a styled callout
// instead of the raw fenced block. Returns null when no proposal block is present.
function parseProposalBlock(text: string): {
  before: string;
  proposalPath: string;
  after: string;
} | null {
  const result = matchProposalBlock(text);
  if (!result) return null;
  const before = text.slice(0, result.index).trimEnd();
  const after = text.slice(result.index + result.fullMatch.length).trimStart();
  let proposalPath = "";
  try {
    const parsed = JSON.parse(result.jsonBody) as { path?: unknown };
    if (typeof parsed.path === "string") proposalPath = parsed.path.trim();
  } catch {
    // JSON parse failed — callout still renders without the path name
  }
  return { before, proposalPath, after };
}

function AssistantMessage({
  text,
  showCursor,
}: {
  text: string;
  showCursor?: boolean;
}) {
  const proposal = parseProposalBlock(text);

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0 text-cyan-400 text-xs font-bold">
        J
      </div>
      <div className="flex-1">
        <p className="text-xs text-cyan-400 font-medium mb-1">Jarvis</p>

        {proposal ? (
          /* Message contains a write proposal — split into text + callout + text */
          <div className="space-y-2">
            {proposal.before && (
              <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 px-4 py-3 text-sm text-slate-300 whitespace-pre-wrap">
                {proposal.before}
              </div>
            )}

            {/* Styled proposal callout — replaces the raw fenced block */}
            <div className="rounded-lg bg-amber-900/10 border border-amber-500/20 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <span className="text-amber-400 text-sm flex-shrink-0 mt-px select-none">
                  ⚑
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-400">
                    Jarvis proposed a workspace file change
                  </p>
                  {proposal.proposalPath && (
                    <p className="text-xs text-amber-600 mt-0.5 font-mono break-all">
                      workspace/{proposal.proposalPath}
                    </p>
                  )}
                  <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                    Review the diff in the approval panel below before applying.
                    Nothing has been written yet.
                  </p>
                </div>
              </div>
            </div>

            {proposal.after && (
              <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 px-4 py-3 text-sm text-slate-300 whitespace-pre-wrap">
                {proposal.after}
                {showCursor && (
                  <span className="inline-block w-0.5 h-3.5 bg-cyan-400 ml-0.5 align-middle animate-pulse" />
                )}
              </div>
            )}
          </div>
        ) : (
          /* Normal message — no proposal block */
          <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 px-4 py-3 text-sm text-slate-300 whitespace-pre-wrap">
            {text}
            {/* Blinking cursor while tokens are arriving */}
            {showCursor && (
              <span className="inline-block w-0.5 h-3.5 bg-cyan-400 ml-0.5 align-middle animate-pulse" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Shown when the user cancelled a response before it fully arrived.
// Subtle — not a red error, just a muted note.
function CancelledMessage() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center flex-shrink-0 text-slate-600 text-xs select-none">
        ◼
      </div>
      <div className="flex-1 flex items-center">
        <span className="text-xs text-slate-600 italic">Response cancelled.</span>
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3 justify-end">
      <div className="max-w-[75%]">
        <p className="text-xs text-slate-500 font-medium mb-1 text-right">You</p>
        <div className="rounded-lg bg-slate-700/60 border border-slate-600/60 px-4 py-3 text-sm text-slate-200 whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </div>
  );
}

function ErrorMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center flex-shrink-0 text-red-400 text-xs font-bold">
        !
      </div>
      <div className="flex-1">
        <p className="text-xs text-red-400 font-medium mb-1">Error</p>
        <div className="rounded-lg bg-red-900/20 border border-red-700/40 px-4 py-3 text-sm text-red-300">
          {text}
        </div>
      </div>
    </div>
  );
}

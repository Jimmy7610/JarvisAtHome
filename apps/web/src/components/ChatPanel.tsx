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
// The extracted JSON is only accepted if it parses successfully and matches a
// recognised proposal shape: v2 multi-file ({type, version, files[]}) takes
// priority; v1 single-file ({path, content}) is the fallback.
// This prevents any prose from being misidentified as a proposal.

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

          // Validate: must parse as a recognised proposal shape — v1 or v2.
          //
          //   v2 multi-file: { type: "workspace_write_proposal", version: 2, files: [...] }
          //   v1 single-file: { path: string (non-empty), content: string }
          //
          // Check v2 first so the v1 path + content requirement does not incorrectly
          // reject a perfectly valid v2 JSON block that has neither field at the top level.
          //
          // If JSON.parse fails, attempt the v1 multiline-repair fallback — local Ollama
          // models sometimes emit literal newlines inside JSON string values.  The repair
          // is v1-only; v2 proposals from the model are always well-formed JSON.
          //
          // isMultiFileProposal is a hoisted function declaration — safe to call here
          // even though it is declared later in the source file.
          let parsedRaw: unknown;
          try {
            parsedRaw = JSON.parse(jsonBody);
          } catch {
            // JSON.parse failed — attempt the v1 multiline-JSON repair fallback.
            const repaired = repairMultilineProposalJson(jsonBody);
            if (!repaired) return null; // Cannot repair — not a valid proposal.
            // Re-encode as standard valid JSON so every downstream caller that
            // calls JSON.parse(result.jsonBody) works without modification.
            jsonBody = JSON.stringify({ path: repaired.path, content: repaired.content });
            parsedRaw = repaired;
          }
          // v2 multi-file — accept without requiring path/content
          if (!isMultiFileProposal(parsedRaw)) {
            // v1 single-file — require non-empty path and content string
            const v1 = parsedRaw as { path?: unknown; content?: unknown };
            if (typeof v1.path !== "string" || !v1.path.trim()) return null;
            if (typeof v1.content !== "string") return null;
          }

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
//   1. The ENTIRE text is just a JSON object or a single fenced block (```json / ```).
//      Any surrounding explanatory prose causes immediate rejection.
//      Note: fenced blocks using the ```jarvis-write-proposal language tag are
//      handled by extractWriteProposal, not this function.
//   2. JSON.parse succeeds on the extracted body.
//   3. The parsed JSON matches a recognised proposal shape:
//        v2: { type: "workspace_write_proposal", version: 2, files: [...] }
//        v1: { path: string (non-empty), content: string }
//
// The fallback still creates only a PENDING proposal — backend validation and the
// user's Approve click are still required before any file is written.
//
// Accepted:
//   Bare JSON (v1):   {"path":"file.md","content":"# Hello\nWorld"}
//   Bare JSON (v2):   {"type":"workspace_write_proposal","version":2,"files":[...]}
//   Fenced JSON only: ```json\n{...}\n```  or  ```\n{...}\n```
//
// Rejected:
//   Any surrounding explanatory prose or extra text
//   Malformed or partial JSON
//   JSON without a recognised v1 or v2 proposal shape

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

  // Validate: must parse and have a recognised proposal shape (v1 or v2).
  // v1 single-file: { path: string, content: string }
  // v2 multi-file:  { type: "workspace_write_proposal", version: 2, files: [...] }
  //
  // isMultiFileProposal is a function declaration (hoisted) so calling it here is safe
  // even though it is defined later in the module.
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null; // malformed or partial JSON
  }
  // v1 check
  const parsedV1 = parsed as { path?: unknown; content?: unknown };
  if (typeof parsedV1.path === "string" && parsedV1.path.trim() &&
      typeof parsedV1.content === "string") {
    return candidate;
  }
  // v2 check
  if (isMultiFileProposal(parsed)) {
    return candidate;
  }

  return null;
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

// ── Multi-file proposal types (v2 format) ─────────────────────────────────────

// The expected JSON shape for a v2 multi-file write proposal
type MultiFileProposalJson = {
  type: "workspace_write_proposal";
  version: 2;
  summary?: string;
  files: Array<{
    operation: "create" | "update";
    path: string;
    content: string;
  }>;
};

// Type guard — confirms the parsed JSON is a v2 multi-file proposal.
// Checks: correct type string, version 2, and a non-empty files array.
function isMultiFileProposal(obj: unknown): obj is MultiFileProposalJson {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    o.type === "workspace_write_proposal" &&
    o.version === 2 &&
    Array.isArray(o.files) &&
    (o.files as unknown[]).length > 0
  );
}

// ── Multi-file proposal validation helpers ────────────────────────────────────

// Format a byte count (from content.length; valid for ASCII files) as a compact
// human-readable size string.  Used in the pre-approval validation summary row.
function formatContentSize(bytes: number): string {
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// Warning entry returned by computeMultiProposalWarnings.
// key is stable for React list rendering; message is user-visible.
interface MultiProposalWarning {
  key: string;
  message: string;
}

// Compute pre-approval advisory warnings for a pending multi-file proposal.
// These are informational only — backend validation is the authoritative safety
// layer and these checks must never replace it.
//
// Checks performed (all frontend-only, O(n) over the proposal list):
//   1. Duplicate path — same normalised path appears in two or more entries.
//   2. Empty content  — content string is empty or whitespace-only.
function computeMultiProposalWarnings(
  proposals: Array<{ path: string; operation: string; content: string }>
): MultiProposalWarning[] {
  const warnings: MultiProposalWarning[] = [];

  // 1. Duplicate path (case-insensitive, backslash → forward-slash normalised)
  const seen = new Map<string, number>(); // normalised path → 1-based index of first occurrence
  for (let i = 0; i < proposals.length; i++) {
    const normalised = proposals[i].path.toLowerCase().replace(/\\/g, "/").trim();
    const prev = seen.get(normalised);
    if (prev !== undefined) {
      warnings.push({
        key: `dup-${i}`,
        message: `Duplicate path: files ${prev} and ${i + 1} both target workspace/${proposals[i].path}`,
      });
    } else {
      seen.set(normalised, i + 1); // 1-based for readable message
    }
  }

  // 2. Empty content
  for (let i = 0; i < proposals.length; i++) {
    if (!proposals[i].content.trim()) {
      warnings.push({
        key: `empty-${i}`,
        message: `File ${i + 1} (${proposals[i].path}) has empty content`,
      });
    }
  }

  return warnings;
}

// ── Agent plan types and detection (jarvis-agent-plan format) ────────────────
//
// An agent plan block lets Jarvis present an ordered, step-by-step plan for
// multi-step work.  The user reviews the plan and marks steps done manually —
// NOTHING runs automatically.  If a step requires file writes, a separate
// jarvis-write-proposal block must be submitted and approved as normal.
//
// Block format:
//   ```jarvis-agent-plan
//   {"type":"jarvis_agent_plan","version":1,"title":"...","steps":[...]}
//   ```
//
// The bare-JSON fallback also accepts a bare { type: "jarvis_agent_plan" } object
// when the entire message is a single JSON object (same rule as write proposals).

// Valid step kinds used for badge display.
type AgentPlanStepKind = "analysis" | "code" | "docs" | "test" | "review";

// Valid step statuses — also the values the model may set in the initial JSON.
type AgentPlanStepStatus = "planned" | "in_progress" | "done" | "blocked";

// Mutable in-component step shape (status toggled, notes written by the user via plan panel).
interface AgentPlanStep {
  id: string;
  title: string;
  description: string;
  kind?: AgentPlanStepKind;
  status: AgentPlanStepStatus;
  // Optional user-written annotation. Max 1000 chars. Never injected into model prompt.
  note?: string;
}

// Mutable in-component plan shape stored as component state.
interface AgentPlanState {
  title: string;
  summary?: string;
  steps: AgentPlanStep[];
}

// Raw JSON shape emitted by the model — read-only, parsed once into AgentPlanState.
// kind/status are kept as string so the validator can accept or reject unknown values.
type AgentPlanJson = {
  type: "jarvis_agent_plan";
  version: 1;
  title: string;
  summary?: string;
  steps: Array<{
    id: string;
    title: string;
    description: string;
    kind?: string;
    status?: string;
    // note is accepted if present in the incoming JSON (forward-compat).
    // It is trimmed and capped at 1000 chars during parseAgentPlan.
    note?: string;
  }>;
};

// Type guard — confirms the parsed JSON matches the v1 jarvis-agent-plan shape.
// isAgentPlan is a function declaration so it is hoisted and can be called by
// the extractor functions that appear later in the source.
function isAgentPlan(obj: unknown): obj is AgentPlanJson {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  if (o.type !== "jarvis_agent_plan") return false;
  if (o.version !== 1) return false;
  if (typeof o.title !== "string" || !o.title.trim()) return false;
  if (!Array.isArray(o.steps) || (o.steps as unknown[]).length === 0) return false;
  if ((o.steps as unknown[]).length > 10) return false;
  for (const step of o.steps as unknown[]) {
    if (typeof step !== "object" || step === null) return false;
    const s = step as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id.trim()) return false;
    if (typeof s.title !== "string" || !s.title.trim()) return false;
    if (typeof s.description !== "string") return false;
  }
  return true;
}

// Parse a validated agent plan JSON string into the mutable AgentPlanState.
// Normalises optional kind/status fields to known values or safe defaults.
// Returns null if JSON.parse or the type guard fails.
function parseAgentPlan(jsonBody: string): AgentPlanState | null {
  let parsed: unknown;
  try { parsed = JSON.parse(jsonBody); } catch { return null; }
  if (!isAgentPlan(parsed)) return null;

  const VALID_KINDS = new Set<string>(["analysis", "code", "docs", "test", "review"]);
  const VALID_STATUSES = new Set<string>(["planned", "in_progress", "done", "blocked"]);

  return {
    title: parsed.title.trim(),
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : undefined,
    steps: parsed.steps.map((s) => {
      const kind = s.kind && VALID_KINDS.has(s.kind)
        ? (s.kind as AgentPlanStepKind)
        : undefined;
      const status = s.status && VALID_STATUSES.has(s.status)
        ? (s.status as AgentPlanStepStatus)
        : "planned";
      // Accept an optional note from the JSON (e.g. user-pasted plan with saved notes).
      // Trim and cap at 1000 chars; absent or empty becomes undefined.
      const rawNote = typeof s.note === "string" ? s.note.trim().slice(0, 1000) : undefined;
      const note = rawNote || undefined;
      return { id: s.id.trim(), title: s.title.trim(), description: s.description, kind, status, note };
    }),
  };
}

// Marker used in fenced agent plan blocks.
const AGENT_PLAN_MARKER = "jarvis-agent-plan";

// Locate the ```jarvis-agent-plan fenced block, extract the first complete JSON
// object using brace-balancing (same technique as extractWriteProposal), then
// validate it with isAgentPlan.  Returns the raw JSON string or null.
function extractAgentPlanFromFence(text: string): string | null {
  const markerPos = text.indexOf(AGENT_PLAN_MARKER);
  if (markerPos === -1) return null;

  // Scan forward from the end of the marker to the first {
  let jsonStart = -1;
  for (let i = markerPos + AGENT_PLAN_MARKER.length; i < text.length; i++) {
    if (text[i] === "{") { jsonStart = i; break; }
  }
  if (jsonStart === -1) return null;

  // Brace-balance to extract the complete JSON object (handles strings + escapes)
  let depth = 0;
  let inString = false;
  let i = jsonStart;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === '"') inString = false;
    } else {
      if (ch === '"') { inString = true; }
      else if (ch === "{") { depth++; }
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const jsonBody = text.slice(jsonStart, i + 1);
          let parsed: unknown;
          try { parsed = JSON.parse(jsonBody); } catch { return null; }
          return isAgentPlan(parsed) ? jsonBody : null;
        }
      }
    }
    i++;
  }
  return null;
}

// Bare-JSON fallback for agent plans: fire ONLY when the entire trimmed text is
// a single JSON object (or a ```json/``` fenced block) whose parsed form passes
// isAgentPlan.  Mirrors extractBareJsonProposal.
function extractBareAgentPlan(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let candidate: string | null = null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidate = trimmed;
  } else {
    const fenceMatch = /^```(?:json)?\s*\r?\n([\s\S]+?)\r?\n[ \t]*```\s*$/.exec(trimmed);
    if (fenceMatch) {
      const inner = fenceMatch[1].trim();
      if (inner.startsWith("{") && inner.endsWith("}")) candidate = inner;
    }
  }
  if (candidate === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { return null; }
  return isAgentPlan(parsed) ? candidate : null;
}

// Adapter: tries the fenced-block extractor first, then the bare-JSON fallback.
// Returns the raw JSON string, or null if no valid plan is found.
function matchAgentPlanBlock(text: string): string | null {
  return extractAgentPlanFromFence(text) ?? extractBareAgentPlan(text);
}

interface ChatMessage {
  role: "user" | "assistant" | "error" | "cancelled";
  text: string;
  // The Ollama model that generated this message (assistant messages only).
  // Set from the "done" stream event (actual resolved backend model) or, for
  // messages loaded from SQLite, from BackendMessage.model.
  // Undefined for user messages, error/cancelled bubbles, and the greeting.
  model?: string;
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

// ─── Agent plan persistence helpers ──────────────────────────────────────────
//
// Plans are persisted per chat session in a single localStorage entry shaped as:
//   { "<sessionId>": AgentPlanState }
//
// This mirrors the pattern used by jarvis:memory-context-by-session.
// Plans are never sent to the backend — they live only in the browser.
// The entry is keyed by the numeric session ID converted to a string.

const AGENT_PLAN_BY_SESSION_KEY = "jarvis:agent-plan-by-session";

// Read the entire session → plan map from localStorage.
function readAgentPlanMap(): Record<string, AgentPlanState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(AGENT_PLAN_BY_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, AgentPlanState>;
  } catch {
    return {};
  }
}

// Write the entire session → plan map back to localStorage.
function writeAgentPlanMap(map: Record<string, AgentPlanState>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AGENT_PLAN_BY_SESSION_KEY, JSON.stringify(map));
  } catch {
    // Storage quota exceeded — not fatal
  }
}

// Return the persisted plan for a specific session, or null if none exists.
function readAgentPlanForSession(sessionId: number | null): AgentPlanState | null {
  if (sessionId === null) return null;
  const map = readAgentPlanMap();
  return map[String(sessionId)] ?? null;
}

// Persist the current plan for a specific session.
function saveAgentPlanForSession(sessionId: number | null, plan: AgentPlanState): void {
  if (sessionId === null) return;
  const map = readAgentPlanMap();
  map[String(sessionId)] = plan;
  writeAgentPlanMap(map);
}

// Remove the persisted plan for a specific session (on clear or session delete).
function removeAgentPlanForSession(sessionId: number | null): void {
  if (sessionId === null) return;
  const map = readAgentPlanMap();
  delete map[String(sessionId)];
  writeAgentPlanMap(map);
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
      // Carry model from the persisted record when available
      ...(m.model ? { model: m.model } : {}),
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
  attachedProjectFile,
  onClearAttachedProjectFile,
  prefillInput,
  onConsumePrefill,
  onActivity,
  onOpenWorkspaceFile,
  modelOverride,
  defaultModel,
  memoryContext,
  onClearMemoryContext,
}: {
  // Called after a session title is successfully updated (e.g. auto-title after first message).
  // Parent uses this to refresh the session list without reloading the page.
  onSessionUpdated?: () => void;
  // File attached via WorkspacePanel — prepended to the next outgoing message.
  attachment?: { path: string; content: string; size: number } | null;
  // Called by ChatPanel immediately when it consumes the workspace attachment in send().
  onClearAttachment?: () => void;
  // File attached via Project Library — prepended to the next outgoing message.
  // Content is already loaded (fetched by ProjectLibraryPanel via the safe /projects route).
  attachedProjectFile?: {
    projectName: string;
    path: string;
    content: string;
    size: number;
  } | null;
  // Called by ChatPanel immediately when it consumes the project file attachment in send().
  onClearAttachedProjectFile?: () => void;
  // Suggested question set by "Ask Jarvis about this file". Applied once to the input field.
  prefillInput?: string | null;
  // Called after ChatPanel reads prefillInput so the parent can reset it to null.
  onConsumePrefill?: () => void;
  // Reports a named activity event to the parent for display in ActivityPanel.
  onActivity?: (text: string, type?: "info" | "write" | "error") => void;
  // Called when the user clicks "Open draft" after a successful write.
  // Parent (page.tsx) forwards the path to WorkspacePanel for navigation and preview.
  onOpenWorkspaceFile?: (relativePath: string) => void;
  // Optional Ollama model override set by the user in Settings.
  // When present, this model name is forwarded to the /chat/stream endpoint.
  // If null/undefined the backend resolves the model using its configured default.
  modelOverride?: string | null;
  // Backend-configured default Ollama model name (e.g. "qwen2.5-coder:latest").
  // Fetched once by page.tsx from /settings. Used only for display in the header pill.
  // If null (API not yet reachable) the pill shows "default model" as a fallback label.
  defaultModel?: string | null;
  // Memory notes the user has opted-in to include in chat context.
  // Managed by page.tsx — these are prepended to the outgoing API message as explicit context.
  // An empty array / undefined means no memory context is active.
  // SAFETY: memory context is injected only when the user explicitly includes notes.
  // The AI cannot add, edit, or inject memories autonomously.
  memoryContext?: { id: string; type: string; title: string; content: string }[];
  // Called when the user clicks "Clear all" on the memory context chip.
  onClearMemoryContext?: () => void;
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

  // ── Multi-file template helper state ──────────────────────────────────────
  // true for 2 s after the user clicks "Copy multi-file template" — shows a
  // "✓ Template copied" label in place of the button text.
  const [templateCopied, setTemplateCopied] = useState(false);

  // ── Multi-file proposal state (v2 format) ─────────────────────────────────
  // Set when the assistant proposes multiple files in a single response block.
  // Each entry mirrors the single-file chatProposal shape.
  const [chatMultiProposals, setChatMultiProposals] = useState<Array<{
    id: string;
    path: string;
    operation: "edit" | "create";
    diff: DiffLine[];
    // Full proposed content — stored so it can be used if needed after approval.
    content: string;
  }> | null>(null);
  // Human-readable summary from the v2 proposal JSON "summary" field (optional).
  const [chatMultiSummary, setChatMultiSummary] = useState<string | null>(null);
  // true while sequential approve-all is in progress (prevents double-click).
  const [chatApproveAllLoading, setChatApproveAllLoading] = useState(false);
  // Set of proposal IDs the user has included for writing.
  // Initialised to ALL file IDs when a new multi-file proposal arrives so that the default
  // state is "everything included".  Toggled per file by the Include/Skip button.
  // Cleared on cancel, on new send, and after successful approve.
  const [selectedMultiProposalIds, setSelectedMultiProposalIds] = useState<Set<string>>(new Set());

  // ── Agent plan state ──────────────────────────────────────────────────────
  // Set when the assistant response or user input contains a jarvis-agent-plan block.
  // null = no active plan.  Step statuses and per-step notes are mutable via the
  // plan panel UI.  Plans are persisted per session in localStorage (v1.3.1+).
  // Cleared only by the × dismiss button (handleClearPlan).
  const [chatAgentPlan, setChatAgentPlan] = useState<AgentPlanState | null>(null);

  // ── Agent plan note-editing state ─────────────────────────────────────────
  // Only one note editor can be open at a time.
  // editingNoteStepId — which step's note is being edited (null = none open).
  // editingNoteText   — current draft text in the textarea.
  const [editingNoteStepId, setEditingNoteStepId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState<string>("");

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
  // Holds the active HTMLAudioElement used for local TTS playback.
  // Replaced on each new local TTS utterance; stopped by stopVoice().
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Holds the current object URL created from a local TTS audio blob.
  // Revoked after playback ends to avoid memory leaks.
  const objectUrlRef = useRef<string | null>(null);

  // Load chat history after mount — backend is preferred, localStorage is the fallback.
  // Must run after mount (not during render) to avoid server/client HTML mismatch.
  useEffect(() => {
    const existingId = loadSessionId();

    if (existingId !== null) {
      // Session id stored — try to restore from backend first.
      sessionIdRef.current = existingId;
      // Restore the agent plan for this session from localStorage (if one was saved).
      const savedPlan = readAgentPlanForSession(existingId);
      if (savedPlan) setChatAgentPlan(savedPlan);
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
  // Also cancel any ongoing speech recognition, browser synthesis, and local TTS audio.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      recognitionRef.current?.abort();
      if (speechTimerRef.current !== null) clearTimeout(speechTimerRef.current);
      if (typeof window !== "undefined")
        (window as unknown as JarvisWindow).speechSynthesis?.cancel();
      // Stop local TTS audio and revoke the object URL to free memory.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
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
  // Stops both browser SpeechSynthesis and any active local TTS audio element.
  useEffect(() => {
    if (!speakReplies && typeof window !== "undefined") {
      if (speechTimerRef.current !== null) {
        clearTimeout(speechTimerRef.current);
        speechTimerRef.current = null;
      }
      (window as unknown as JarvisWindow).speechSynthesis?.cancel();
      // Stop local TTS audio if it is currently playing.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
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
  // Supports both v1 (single-file: {path, content}) and v2 (multi-file: {type, version,
  // summary, files[]}) proposal formats. Nothing is written to disk here — the user
  // must click "Approve write" or "Approve all N files".
  async function detectAndPropose(text: string): Promise<void> {
    const result = matchProposalBlock(text);
    if (!result) return;

    // Distinguish in the activity log whether the preferred marker path or the
    // bare-JSON fallback fired (no "jarvis-write-proposal" marker in the text).
    const isBareJsonFallback = !text.includes("jarvis-write-proposal");
    setChatProposalLoading(true);
    setChatProposalError(null);
    setChatWriteSuccess(false);

    // Parse the JSON body extracted by matchProposalBlock.
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.jsonBody);
    } catch {
      const errMsg = "Failed to parse write proposal JSON from assistant response.";
      setChatProposalError(errMsg);
      setChatProposalLoading(false);
      onActivity?.(`Chat write proposal parse error: ${errMsg}`, "error");
      return;
    }

    // ── v2 multi-file proposal ──────────────────────────────────────────────
    if (isMultiFileProposal(parsed)) {
      const fileCount = parsed.files.length;
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : null;

      onActivity?.(
        isBareJsonFallback
          ? `Chat multi-file write proposal detected (bare JSON fallback) — ${fileCount} file${fileCount !== 1 ? "s" : ""}…`
          : `Chat write proposal detected: ${fileCount} file${fileCount !== 1 ? "s" : ""} — creating proposals…`,
        "info"
      );

      // Guard: max 5 files per proposal to prevent runaway writes.
      if (fileCount > 5) {
        const errMsg = `Write proposal contains ${fileCount} files; maximum is 5.`;
        setChatProposalError(errMsg);
        setChatProposalLoading(false);
        onActivity?.(`Chat write proposal rejected: ${errMsg}`, "error");
        return;
      }

      // Validate each file entry before making any API calls.
      for (let i = 0; i < parsed.files.length; i++) {
        const f = parsed.files[i];
        if (!f.path || typeof f.path !== "string" || f.path.trim() === "") {
          const errMsg = `File ${i + 1} is missing a path.`;
          setChatProposalError(errMsg);
          setChatProposalLoading(false);
          onActivity?.(`Chat write proposal invalid: ${errMsg}`, "error");
          return;
        }
        if (typeof f.content !== "string") {
          const errMsg = `File ${i + 1} (${f.path}) is missing content.`;
          setChatProposalError(errMsg);
          setChatProposalLoading(false);
          onActivity?.(`Chat write proposal invalid: ${errMsg}`, "error");
          return;
        }
        if (f.operation !== "create" && f.operation !== "update") {
          const errMsg = `File ${i + 1} (${f.path}) has invalid operation "${String(f.operation)}". Use "create" or "update".`;
          setChatProposalError(errMsg);
          setChatProposalLoading(false);
          onActivity?.(`Chat write proposal invalid: ${errMsg}`, "error");
          return;
        }
      }

      // Call POST /files/propose-write for each file sequentially.
      // Stops on first failure so the user doesn't get a half-committed state.
      const proposals: Array<{
        id: string;
        path: string;
        operation: "edit" | "create";
        diff: DiffLine[];
        content: string;
      }> = [];

      try {
        for (const f of parsed.files) {
          const res = await fetch(`${API_URL}/files/propose-write`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: f.path.trim(), content: f.content }),
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
            const errMsg = data.error ?? `Backend rejected proposal for ${f.path}.`;
            setChatProposalError(errMsg);
            setChatProposalLoading(false);
            onActivity?.(`Chat write proposal failed for ${f.path}: ${errMsg}`, "error");
            return;
          }
          proposals.push({
            id: data.id,
            path: data.path ?? f.path.trim(),
            operation: data.operation ?? "edit",
            diff: data.diff,
            content: f.content,
          });
        }
      } catch {
        const errMsg = "API unreachable — is the Jarvis API running?";
        setChatProposalError(errMsg);
        setChatProposalLoading(false);
        onActivity?.(`Chat write proposal failed: ${errMsg}`, "error");
        return;
      }

      setChatMultiProposals(proposals);
      // Initialise selection to every file — all files are included by default.
      // The user can toggle individual files to Skip before clicking Approve.
      setSelectedMultiProposalIds(new Set(proposals.map((p) => p.id)));
      setChatMultiSummary(summary);
      onActivity?.(
        `Chat write proposal: ${fileCount} file${fileCount !== 1 ? "s" : ""} pending approval`,
        "write"
      );
      setChatProposalLoading(false);
      return;
    }

    // ── v1 single-file proposal ─────────────────────────────────────────────
    const parsedV1 = parsed as { path?: unknown; content?: unknown };
    onActivity?.(
      isBareJsonFallback
        ? "Chat write proposal detected (bare JSON fallback) — creating proposal…"
        : "Chat write proposal detected — creating proposal…",
      "info"
    );

    const proposalPath =
      typeof parsedV1.path === "string" ? parsedV1.path.trim() : "";
    const proposalContent =
      typeof parsedV1.content === "string" ? parsedV1.content : null;

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

  // Sequential approve for v2 multi-file proposals — writes only the files the user
  // has included (i.e. whose IDs are in selectedMultiProposalIds).
  // Skipped files are ignored; they are never passed to /files/approve-write.
  // Stops on the first failure so the user never ends up in a half-written state.
  async function handleApproveAll(): Promise<void> {
    if (!chatMultiProposals) return;
    const allProposals = chatMultiProposals;
    // Filter to the user's selected subset — safety guard in addition to the disabled button.
    const selectedProposals = allProposals.filter((p) => selectedMultiProposalIds.has(p.id));
    if (selectedProposals.length === 0) return;

    setChatApproveAllLoading(true);
    setChatApproveError(null);

    try {
      for (const proposal of selectedProposals) {
        const res = await fetch(`${API_URL}/files/approve-write`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalId: proposal.id }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          path?: string;
          written?: boolean;
          error?: string;
        };
        if (!data.ok) {
          const errMsg = data.error ?? "Failed to approve write.";
          setChatApproveError(`Failed to write workspace/${proposal.path}: ${errMsg}`);
          onActivity?.(
            `Chat write approval failed for ${proposal.path}: ${errMsg}`,
            "error"
          );
          return;
        }
        onActivity?.(
          `Chat write approved and applied to workspace/${proposal.path}`,
          "write"
        );
      }
      // All selected files approved successfully
      const skippedCount = allProposals.length - selectedProposals.length;
      onActivity?.(
        skippedCount > 0
          ? `Chat write approved: ${selectedProposals.length} of ${allProposals.length} files written (${skippedCount} skipped)`
          : `Chat write approved: ${selectedProposals.length} file${selectedProposals.length !== 1 ? "s" : ""} written`,
        "write"
      );
      setChatMultiProposals(null);
      setChatMultiSummary(null);
      setSelectedMultiProposalIds(new Set());
      setChatWriteSuccess(true);
      // Multi-file success uses null path — the generic success message shows instead of the draft UI.
      setChatApprovedPath(null);
      setChatApprovedContent(null);
    } catch {
      const errMsg = "API unreachable — is the Jarvis API running?";
      setChatApproveError(errMsg);
      onActivity?.(`Chat write approval failed: ${errMsg}`, "error");
    } finally {
      setChatApproveAllLoading(false);
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
    const multiCount = chatMultiProposals?.length ?? 0;
    setChatProposal(null);
    setChatMultiProposals(null);
    setChatMultiSummary(null);
    setSelectedMultiProposalIds(new Set());
    setChatProposalError(null);
    setChatApproveError(null);
    if (cancelledPath) {
      onActivity?.(
        `Chat write proposal cancelled for workspace/${cancelledPath}`,
        "write"
      );
    } else if (multiCount > 0) {
      onActivity?.(
        `Chat write proposal cancelled (${multiCount} file${multiCount !== 1 ? "s" : ""})`,
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

  // Copy the v2 multi-file write proposal template to the clipboard.
  // If the clipboard API is unavailable (non-HTTPS or permission denied), inserts
  // the template directly into the chat input as a fallback — the user can then
  // edit paths/content and click Send to trigger the local interception flow.
  // Does NOT send the template automatically.
  async function handleCopyMultiFileTemplate(): Promise<void> {
    // Build the template using JSON.stringify for correct JSON escaping.
    // Path examples use safe workspace-relative paths — no traversal, no absolute paths.
    const template =
      "```jarvis-write-proposal\n" +
      JSON.stringify(
        {
          type: "workspace_write_proposal",
          version: 2,
          summary: "Describe the intended changes",
          files: [
            {
              operation: "create",
              path: "sandbox/example-1.md",
              content: "# Example 1\n",
            },
            {
              operation: "update",
              path: "welcome.md",
              content: "# Updated welcome\n",
            },
          ],
        },
        null,
        2
      ) +
      "\n```";

    try {
      await navigator.clipboard.writeText(template);
      setTemplateCopied(true);
      onActivity?.("Multi-file proposal template copied to clipboard", "info");
      // Auto-reset the label after 2 seconds
      setTimeout(() => setTemplateCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-HTTPS or browser restriction) —
      // insert the template into the chat input so the user can still use it.
      setInput(template);
      // Trigger textarea auto-resize to show the full pasted content
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(
          textareaRef.current.scrollHeight,
          200
        )}px`;
      }
      onActivity?.(
        "Multi-file proposal template inserted into input (clipboard unavailable)",
        "info"
      );
    }
  }

  // ── Agent plan handlers ───────────────────────────────────────────────────

  // Called after streaming ends (or from the user-paste interception path) to
  // detect and set a jarvis-agent-plan block in the assistant response.
  // Non-throwing — invalid or missing plans are silently ignored.
  function detectAndSetAgentPlan(text: string): void {
    const jsonBody = matchAgentPlanBlock(text);
    if (!jsonBody) return;
    const plan = parseAgentPlan(jsonBody);
    if (!plan) {
      // JSON parsed but failed validation — log and skip (don't break chat).
      onActivity?.("Agent plan block found but failed validation — ignored", "info");
      return;
    }
    setChatAgentPlan(plan);
    saveAgentPlanForSession(sessionIdRef.current, plan);
    onActivity?.(
      `Agent plan detected: ${plan.steps.length} step${plan.steps.length !== 1 ? "s" : ""}`,
      "info"
    );
  }

  // Mark a single step as "done". No other steps are affected.
  // The updated plan is saved to localStorage so it survives page refresh.
  function handleMarkStepDone(stepId: string): void {
    setChatAgentPlan((prev) => {
      if (!prev) return prev;
      const updated: AgentPlanState = {
        ...prev,
        steps: prev.steps.map((s) =>
          s.id === stepId ? { ...s, status: "done" as AgentPlanStepStatus } : s
        ),
      };
      saveAgentPlanForSession(sessionIdRef.current, updated);
      return updated;
    });
  }

  // Reset a single step to "planned". Used to undo an accidental "done" mark.
  // The updated plan is saved to localStorage so the change persists.
  function handleResetStep(stepId: string): void {
    setChatAgentPlan((prev) => {
      if (!prev) return prev;
      const updated: AgentPlanState = {
        ...prev,
        steps: prev.steps.map((s) =>
          s.id === stepId ? { ...s, status: "planned" as AgentPlanStepStatus } : s
        ),
      };
      saveAgentPlanForSession(sessionIdRef.current, updated);
      return updated;
    });
  }

  // Mark a step as the currently active / in-progress step.
  // Rules:
  //   - Only one step can be in_progress at a time.
  //   - Any existing in_progress step is moved back to "planned".
  //   - Done steps cannot be activated (guard at the top).
  //   - blocked steps CAN be activated (user may want to call attention to a blocker).
  // Saves the updated plan to localStorage immediately and logs an activity event.
  // Active step is visual/manual only — nothing is sent to the model or executed.
  function handleSetStepActive(stepId: string): void {
    setChatAgentPlan((prev) => {
      if (!prev) return prev;
      const target = prev.steps.find((s) => s.id === stepId);
      // Guard: silently ignore if the target is already done or not found
      if (!target || target.status === "done") return prev;
      const updated: AgentPlanState = {
        ...prev,
        steps: prev.steps.map((s) => {
          if (s.id === stepId) return { ...s, status: "in_progress" as AgentPlanStepStatus };
          // Move any other in_progress step back to planned
          if (s.status === "in_progress") return { ...s, status: "planned" as AgentPlanStepStatus };
          return s;
        }),
      };
      saveAgentPlanForSession(sessionIdRef.current, updated);
      onActivity?.(`Agent step active: ${target.title}`, "info");
      return updated;
    });
  }

  // Dismiss the entire plan panel. Does not affect write proposals.
  // Also removes the saved plan from localStorage for the current session.
  function handleClearPlan(): void {
    removeAgentPlanForSession(sessionIdRef.current);
    setChatAgentPlan(null);
    // Close any open note editor so stale state doesn't linger
    setEditingNoteStepId(null);
    setEditingNoteText("");
    onActivity?.("Agent plan cleared", "info");
  }

  // ── Step note handlers ────────────────────────────────────────────────────
  //
  // Notes are manual planning annotations — they are NEVER injected into the
  // model prompt and NEVER trigger any action.  They are stored together with
  // the plan in localStorage so they survive page refresh.

  // Open the inline note editor for a specific step.
  // Populates the textarea with the existing note (empty string if no note yet).
  function handleEditStepNote(stepId: string): void {
    const step = chatAgentPlan?.steps.find((s) => s.id === stepId);
    setEditingNoteText(step?.note ?? "");
    setEditingNoteStepId(stepId);
  }

  // Save the draft note for a step.
  // Trims the text and caps it at 1000 chars.
  // An empty result clears the note field (equivalent to handleClearStepNote).
  // Persists the updated plan immediately; logs a brief activity event.
  function handleSaveStepNote(stepId: string): void {
    const trimmed = editingNoteText.trim().slice(0, 1000);
    setChatAgentPlan((prev) => {
      if (!prev) return prev;
      const step = prev.steps.find((s) => s.id === stepId);
      const updated: AgentPlanState = {
        ...prev,
        steps: prev.steps.map((s) =>
          s.id === stepId ? { ...s, note: trimmed || undefined } : s
        ),
      };
      saveAgentPlanForSession(sessionIdRef.current, updated);
      if (trimmed) {
        onActivity?.(`Agent step note saved: ${step?.title ?? stepId}`, "info");
      } else {
        onActivity?.(`Agent step note cleared: ${step?.title ?? stepId}`, "info");
      }
      return updated;
    });
    setEditingNoteStepId(null);
    setEditingNoteText("");
  }

  // Cancel note editing without saving. Discards the draft.
  function handleCancelStepNote(): void {
    setEditingNoteStepId(null);
    setEditingNoteText("");
  }

  // Clear the note for a step directly from the display row (no editor needed).
  // Persists the updated plan and logs an activity event.
  function handleClearStepNote(stepId: string): void {
    setChatAgentPlan((prev) => {
      if (!prev) return prev;
      const step = prev.steps.find((s) => s.id === stepId);
      const updated: AgentPlanState = {
        ...prev,
        steps: prev.steps.map((s) =>
          s.id === stepId ? { ...s, note: undefined } : s
        ),
      };
      saveAgentPlanForSession(sessionIdRef.current, updated);
      onActivity?.(`Agent step note cleared: ${step?.title ?? stepId}`, "info");
      return updated;
    });
  }

  // ── Ask Jarvis about step ─────────────────────────────────────────────────
  //
  // Pre-fills the chat input with a structured prompt about a specific plan
  // step.  The user can edit or send it at their own discretion.
  //
  // SAFETY CONTRACT:
  //   - Does NOT call send() or Ollama in any way.
  //   - Does NOT change step status, notes, or plan state.
  //   - Does NOT create a write proposal.
  //   - The prompt explicitly instructs the model to use jarvis-write-proposal
  //     for any file changes and wait for approval.
  function handleAskAboutStep(stepId: string): void {
    if (!chatAgentPlan) return;
    const step = chatAgentPlan.steps.find((s) => s.id === stepId);
    if (!step) return;

    // Build the prompt lines, omitting empty optional fields.
    const lines: string[] = [
      "I am working on this Jarvis agent plan:",
      "",
      `Plan: ${chatAgentPlan.title}`,
    ];
    if (chatAgentPlan.summary) {
      lines.push(`Summary: ${chatAgentPlan.summary}`);
    }
    lines.push("", "Current step:");
    lines.push(`- Title: ${step.title}`);
    if (step.kind) lines.push(`- Kind: ${step.kind}`);
    lines.push(`- Status: ${step.status.replace("_", " ")}`);
    if (step.description) lines.push(`- Description: ${step.description}`);
    if (step.note) lines.push(`- Note: ${step.note}`);
    lines.push(
      "",
      "Help me with this step. Do not write files directly. If file changes are needed, use a jarvis-write-proposal block and wait for approval."
    );

    const prompt = lines.join("\n");

    // Set the chat input to the generated prompt.
    setInput(prompt);

    // Auto-grow the textarea so the full prompt is visible immediately.
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
      // Move focus to the input so the user can edit before sending.
      textareaRef.current.focus();
    }

    onActivity?.(`Agent step prompt prepared: ${step.title}`, "info");
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

  // Stop any active local TTS audio and revoke the associated object URL.
  // Safe to call even when no audio is playing.
  function stopLocalAudio(): void {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  // Local TTS implementation — calls POST /tts/speak on the Jarvis API.
  // The API proxies to the local TTS server (Piper/Kokoro) when LOCAL_TTS_ENABLED=true.
  // Audio bytes are returned and played through HTMLAudioElement so that:
  //   - The browser never talks directly to the local TTS server.
  //   - Stopping works via audioRef (same as browser TTS uses speechSynthesis.cancel).
  // If the API returns a JSON error (e.g. "not enabled"), it is shown in speechError.
  async function speakWithLocalTts(text: string): Promise<void> {
    setSpeechError(null);
    // Stop any audio already playing before starting a new utterance.
    stopLocalAudio();

    try {
      const res = await fetch(`${API_URL}/tts/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          lang: speechLangRef.current,
          // Only send voice if one is explicitly selected — empty string means "default".
          voice: selectedVoiceNameRef.current || undefined,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";

      if (res.ok && contentType.startsWith("audio/")) {
        // API returned audio bytes — play them through HTMLAudioElement.
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;

        const audio = new Audio(objectUrl);
        audioRef.current = audio;

        audio.onplay = () => setSpeaking(true);
        audio.onended = () => {
          setSpeaking(false);
          stopLocalAudio();
        };
        audio.onerror = () => {
          setSpeaking(false);
          setSpeechError("Local TTS audio playback failed.");
          stopLocalAudio();
        };

        await audio.play();
      } else {
        // API returned JSON with an error (e.g. "not enabled", "unreachable").
        const data = (await res.json()) as { ok: boolean; error?: string };
        setSpeechError(data.error ?? "Local TTS returned an unexpected response.");
      }
    } catch {
      setSpeechError(
        "Could not reach the Jarvis API for local TTS — is it running on port 4000?"
      );
    }
  }

  // Route TTS to the currently selected provider.
  // All call sites use this function — provider switching is transparent to callers.
  function speakAssistantText(text: string): void {
    if (typeof window === "undefined") return;
    if (!text.trim()) return;
    if (ttsProviderRef.current === "local") {
      void speakWithLocalTts(text);
      return;
    }
    speakWithBrowserTts(text);
  }

  // Cancel any in-progress speech (browser or local TTS) and reset the speaking state.
  // Clears the pending browser speech timer and stops any local TTS audio element.
  function stopVoice(): void {
    if (speechTimerRef.current !== null) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    if (typeof window !== "undefined") {
      (window as unknown as JarvisWindow).speechSynthesis?.cancel();
    }
    stopLocalAudio();
    setSpeaking(false);
    setSpeechError(null);
  }

  // Speak a short preview phrase using the currently selected language and voice.
  // Lets the user audition voices without sending a chat message.
  // Does NOT check speakRepliesRef — this is an explicit user action, not an auto-reply.
  // When the local TTS provider is selected, the preview is forwarded to /tts/speak
  // so the user can hear the configured local server's output (or see the error if not enabled).
  function speakPreview(): void {
    if (typeof window === "undefined") return;

    // Pick the preview phrase for the currently selected language (fresh closure — always current).
    const phrase =
      VOICE_PREVIEW_PHRASES[speechLang] ??
      VOICE_PREVIEW_PHRASES["en-US"] ??
      "Jarvis voice preview.";

    if (ttsProvider === "local") {
      void speakWithLocalTts(phrase);
      return;
    }

    const jw = window as unknown as JarvisWindow;
    if (!jw.speechSynthesis || !jw.SpeechSynthesisUtterance) return;

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

    // Clear any previous chat-created write proposal so the next response starts fresh.
    // Covers both single-file (chatProposal) and multi-file (chatMultiProposals) state.
    // Note: chatAgentPlan is NOT cleared here — plans persist across messages within
    // a session (the user explicitly dismisses them with the × button).
    setChatProposal(null);
    setChatMultiProposals(null);
    setChatMultiSummary(null);
    setSelectedMultiProposalIds(new Set());
    setChatProposalError(null);
    setChatApproveError(null);
    setChatWriteSuccess(false);
    setChatApprovedPath(null);
    setChatApprovedContent(null);
    setChatCopied(false);
    setChatCopyError(null);
    setSpeechError(null);

    // ── User-pasted agent plan interception ──────────────────────────────────
    // If the trimmed input contains (or is) a ```jarvis-agent-plan fenced block or
    // a bare JSON object with type "jarvis_agent_plan", intercept it here before
    // Ollama is called.  The plan is displayed immediately in the plan panel;
    // no Ollama call is made, nothing is written automatically.
    const userPlanJsonBody = matchAgentPlanBlock(trimmed);
    if (userPlanJsonBody) {
      const plan = parseAgentPlan(userPlanJsonBody);
      if (plan) {
        onActivity?.(
          `Agent plan detected from user input: ${plan.steps.length} step${plan.steps.length !== 1 ? "s" : ""}`,
          "info"
        );
        setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
        setInput("");
        const isFirstPlanMessage = !messages.some((m) => m.role === "user");
        const planSid = sessionIdRef.current;
        if (planSid !== null) {
          void persistMessage(planSid, "user", trimmed);
          if (isFirstPlanMessage) {
            void updateSessionTitle(planSid, trimmed.slice(0, 50)).then(() => {
              onSessionUpdated?.();
            });
          }
        }
        setChatAgentPlan(plan);
        saveAgentPlanForSession(planSid, plan);
        return;
      }
    }

    // ── User-pasted proposal interception ─────────────────────────────────────
    // If the trimmed input is (or contains) a jarvis-write-proposal block — either
    // with the explicit ```jarvis-write-proposal marker or as bare JSON — intercept
    // it here before calling Ollama.  We parse and create the pending proposal
    // locally using the same detectAndPropose() path as assistant-generated proposals.
    //
    // Why this is needed: without interception the raw JSON lands in the chat input,
    // gets sent to /chat/stream, and the model responds with "I can't help with that"
    // instead of the Pending Write Approval banner appearing.
    //
    // Handles both v1 (single-file: {path, content}) and v2 (multi-file: {type,
    // version, files[]}) formats.  No Ollama call is made for intercepted proposals.
    const userProposalMatch = matchProposalBlock(trimmed);
    if (userProposalMatch) {
      // Determine file count for the activity log entry
      let userProposalFileCount = 1;
      try {
        const parsedCheck = JSON.parse(userProposalMatch.jsonBody) as unknown;
        if (isMultiFileProposal(parsedCheck)) {
          userProposalFileCount = parsedCheck.files.length;
        }
      } catch { /* ignore — detectAndPropose will surface any parse error in the banner */ }

      onActivity?.(
        `Write proposal detected from user input: ${userProposalFileCount} file${userProposalFileCount !== 1 ? "s" : ""}`,
        "info"
      );

      // Show the user bubble with the raw pasted text (same as any other user message)
      setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
      setInput("");

      // Persist the user message and auto-title the session if this is the first message
      const isFirstUserMessage = !messages.some((m) => m.role === "user");
      const interceptSid = sessionIdRef.current;
      if (interceptSid !== null) {
        void persistMessage(interceptSid, "user", trimmed);
        if (isFirstUserMessage) {
          void updateSessionTitle(interceptSid, trimmed.slice(0, 50)).then(() => {
            onSessionUpdated?.();
          });
        }
      }

      // Run the same proposal detection used for assistant responses.
      // detectAndPropose() handles v1/v2 detection, per-file propose-write API calls,
      // state updates (chatProposal / chatMultiProposals), and activity log events.
      await detectAndPropose(trimmed);
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Snapshot and immediately clear both attachments so neither can be sent twice
    const attachmentSnapshot = attachment ?? null;
    onClearAttachment?.();

    const projectFileSnapshot = attachedProjectFile ?? null;
    onClearAttachedProjectFile?.();

    // Snapshot the memory context — selection is NOT cleared automatically on send.
    // The user explicitly manages it (toggle off or "Clear all" in MemoryPanel).
    // An empty array means no memory context is active.
    const memorySnapshot =
      memoryContext && memoryContext.length > 0 ? [...memoryContext] : null;

    // Capture history from current messages before the new user turn is added
    const history = buildHistory(messages);
    // Detect first user message so we can auto-title the session afterwards
    const isFirstUserMessage = !messages.some((m) => m.role === "user");

    // Build the text shown in the UI bubble — typed message plus small attachment label(s).
    // File content and memory content are NOT shown in the bubble to keep it readable.
    let bubbleText = trimmed;
    if (memorySnapshot) {
      // Show a compact label so the user knows context was included; content never shown
      bubbleText += `\n\n[Memory context: ${memorySnapshot.length} note${memorySnapshot.length !== 1 ? "s" : ""}]`;
    }
    if (attachmentSnapshot) {
      bubbleText += `\n\n[Attached workspace file: ${attachmentSnapshot.path}]`;
    }
    if (projectFileSnapshot) {
      bubbleText += `\n\n[Attached project file: ${projectFileSnapshot.projectName}/${projectFileSnapshot.path}]`;
    }

    // Build the API message — prepend context block(s) before the user's question.
    // Memory context goes first (outermost context), then file attachments, then the question.
    const fence = "```";
    let apiMessage = trimmed;
    if (attachmentSnapshot) {
      apiMessage =
        `The user attached the following read-only workspace file:\n\n` +
        `File: ${attachmentSnapshot.path}\n\n` +
        `${fence}\n${attachmentSnapshot.content}\n${fence}\n\n` +
        apiMessage;
    }
    if (projectFileSnapshot) {
      apiMessage =
        `The user attached the following read-only project file:\n\n` +
        `Project: ${projectFileSnapshot.projectName}\n` +
        `File: ${projectFileSnapshot.path}\n\n` +
        `${fence}\n${projectFileSnapshot.content}\n${fence}\n\n` +
        apiMessage;
    }
    if (memorySnapshot) {
      // Build the labeled memory context block, then prepend to the message.
      // Each note is labelled with its type so the model has useful metadata.
      // Content is never logged — only sent to the local Ollama endpoint.
      const memoryBlock =
        `The user explicitly selected the following local memory notes as chat context:\n\n` +
        memorySnapshot
          .map((m) => `[${m.type}] ${m.title}\n${m.content}`)
          .join("\n\n") +
        "\n\n";
      apiMessage = memoryBlock + apiMessage;
      onActivity?.(
        `Memory context injected: ${memorySnapshot.map((m) => m.title).join(", ")}`,
        "info"
      );
    }

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
        body: JSON.stringify({
          message: apiMessage,
          history,
          // Forward the user's model override if one is set; otherwise the backend
          // resolves the default model from its own config.
          ...(modelOverride ? { model: modelOverride } : {}),
        }),
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
        // Stamp the actual resolved model (from the "done" event) on the in-memory
        // message so the per-message model indicator renders correctly.
        // Fallback chain: done model → user's override → configured default → nothing.
        const effectiveModel =
          modelName ?? modelOverride ?? defaultModel ?? undefined;
        if (effectiveModel) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = { ...last, model: effectiveModel };
            }
            return updated;
          });
        }
        // Scan for a jarvis-write-proposal block and create a pending proposal if found
        void detectAndPropose(assistantText);
        // Scan for a jarvis-agent-plan block and display the plan panel if found
        detectAndSetAgentPlan(assistantText);
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
            // Stamp model on the partial message that was kept in state
            const effectiveModel =
              modelName ?? modelOverride ?? defaultModel ?? undefined;
            if (effectiveModel) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === "assistant") {
                  updated[updated.length - 1] = { ...last, model: effectiveModel };
                }
                return updated;
              });
            }
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
        {/* Right side: model pill + clear button */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Model indicator pill — shows effective model and source */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 select-none">
            <span className="text-slate-600">Ollama</span>
            <span className="text-slate-700">·</span>
            <span className="font-mono text-cyan-400 max-w-[11rem] truncate">
              {modelOverride ?? defaultModel ?? "default model"}
            </span>
            {modelOverride && (
              <>
                <span className="text-slate-700">·</span>
                <span className="text-amber-400/80">override</span>
              </>
            )}
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
              model={msg.model}
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
      {(chatProposal || chatMultiProposals || chatProposalLoading || chatProposalError || chatWriteSuccess) && (
        <div className="flex-shrink-0 border-t border-amber-500/20 bg-amber-900/10">
          {/* Banner header */}
          <div className="flex items-center justify-between px-6 py-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-widest">
                {chatWriteSuccess ? "Write applied" : "Pending write approval"}
              </p>
              {/* Email draft badge — visible while a single drafts/ proposal is pending */}
              {chatProposal?.path.startsWith("drafts/") && (
                <span className="text-xs px-1.5 py-px rounded bg-cyan-500/10 text-cyan-500/80 border border-cyan-500/20 font-medium">
                  email draft
                </span>
              )}
              {/* File count badge — visible for multi-file proposals */}
              {chatMultiProposals && (
                <span className="text-xs px-1.5 py-px rounded bg-amber-500/10 text-amber-500/80 border border-amber-500/20 font-medium">
                  {chatMultiProposals.length} files
                </span>
              )}
            </div>
            {(chatWriteSuccess || chatProposalError) && (
              <button
                onClick={() => {
                  setChatProposal(null);
                  setChatMultiProposals(null);
                  setChatMultiSummary(null);
                  setSelectedMultiProposalIds(new Set());
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

          {/* ── Multi-file proposal section (v2 format) ──────────────────────── */}
          {chatMultiProposals && (() => {
            // Derive selection counts once so JSX expressions stay readable.
            const totalFiles = chatMultiProposals.length;
            const selectedProposals = chatMultiProposals.filter((p) => selectedMultiProposalIds.has(p.id));
            const selectedCount = selectedProposals.length;
            const skippedCount = totalFiles - selectedCount;
            const allSkipped = selectedCount === 0;
            // Stats computed over the selected subset for accuracy.
            const selectedCreateCount = selectedProposals.filter((p) => p.operation === "create").length;
            const selectedUpdateCount = selectedProposals.filter((p) => p.operation === "edit").length;
            const selectedTotalBytes = selectedProposals.reduce((sum, p) => sum + p.content.length, 0);
            // Warnings computed over selected files only — skipped files are irrelevant.
            const warnings = computeMultiProposalWarnings(selectedProposals);

            return (
              <>
                {/* Validation summary — stats + warnings */}
                <div className="px-6 pb-1">
                  {/* Optional human-readable summary from the proposal JSON */}
                  {chatMultiSummary && (
                    <p className="text-xs text-amber-600/80 italic mb-1">
                      {chatMultiSummary}
                    </p>
                  )}

                  {/* Compact stats row — reflects selection state */}
                  <p className="text-xs text-amber-700">
                    {totalFiles} file{totalFiles !== 1 ? "s" : ""}
                    {" · "}
                    <span className={selectedCount > 0 ? "text-green-500/80" : "text-slate-600"}>
                      {selectedCount} selected
                    </span>
                    {skippedCount > 0 && (
                      <> · <span className="text-slate-600">{skippedCount} skipped</span></>
                    )}
                    {selectedCount > 0 && (
                      <>
                        {" · "}{selectedCreateCount} create
                        {" · "}{selectedUpdateCount} update
                        {" · "}{formatContentSize(selectedTotalBytes)}{" "}selected
                      </>
                    )}
                  </p>

                  {/* Advisory warnings — non-blocking; backend remains the source of truth */}
                  {warnings.map((w) => (
                    <p key={w.key} className="mt-1 text-xs text-amber-500/80">
                      ⚠ {w.message}
                    </p>
                  ))}
                </div>

                {/* Per-file diff sections */}
                {chatMultiProposals.map((proposal, idx) => {
                  const isSelected = selectedMultiProposalIds.has(proposal.id);
                  return (
                    <div
                      key={proposal.id}
                      className={`mx-6 mb-2 transition-opacity ${isSelected ? "opacity-100" : "opacity-40"}`}
                    >
                      {/* File header — include/skip toggle · path · operation badge · size · counter */}
                      <div className={`flex items-center gap-2 px-3 py-1.5 border border-slate-700/60 rounded-t ${isSelected ? "bg-slate-800" : "bg-slate-800/50"}`}>
                        {/* Include / Skip toggle — flips this file in/out of the selection */}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedMultiProposalIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(proposal.id)) {
                                next.delete(proposal.id);
                              } else {
                                next.add(proposal.id);
                              }
                              return next;
                            })
                          }
                          title={isSelected ? "Click to skip this file" : "Click to include this file"}
                          className={`text-xs px-1.5 py-px rounded border font-medium flex-shrink-0 transition-colors ${
                            isSelected
                              ? "bg-green-900/20 text-green-400 border-green-600/30 hover:bg-red-900/20 hover:text-red-400 hover:border-red-600/30"
                              : "bg-slate-700/40 text-slate-500 border-slate-600/30 hover:bg-green-900/20 hover:text-green-400 hover:border-green-600/30"
                          }`}
                        >
                          {isSelected ? "✓ Include" : "Skip"}
                        </button>
                        <span className="text-amber-500/80 font-mono text-xs truncate flex-1">
                          workspace/{proposal.path}
                        </span>
                        {/* Operation badge: green "new file" for create, muted "update" for edit */}
                        {proposal.operation === "create" ? (
                          <span className="text-xs px-1.5 py-px rounded bg-green-900/30 text-green-400 border border-green-600/30 font-medium flex-shrink-0">
                            new file
                          </span>
                        ) : (
                          <span className="text-xs px-1.5 py-px rounded bg-slate-700/60 text-slate-400 border border-slate-600/40 font-medium flex-shrink-0">
                            update
                          </span>
                        )}
                        {/* Content size (character count; valid for ASCII workspace files) */}
                        <span className="text-xs text-slate-600 flex-shrink-0 select-none font-mono">
                          {formatContentSize(proposal.content.length)}
                        </span>
                        {/* File counter */}
                        <span className="text-xs text-slate-700 flex-shrink-0 select-none">
                          {idx + 1}/{totalFiles}
                        </span>
                      </div>
                      {/* Scrollable diff body */}
                      <div
                        className="overflow-y-auto border border-t-0 border-slate-700/60 rounded-b"
                        style={{ maxHeight: "140px" }}
                      >
                        {getDisplayLines(proposal.diff).map((line, i) => {
                          if (line.type === "gap") {
                            return (
                              <div
                                key={i}
                                className="pl-2 pr-3 py-0.5 text-xs text-slate-600 bg-slate-800/40 text-center select-none border-l-2 border-transparent"
                              >
                                ···&nbsp;&nbsp;{line.count} unchanged line{line.count !== 1 ? "s" : ""}
                              </div>
                            );
                          }
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
                  );
                })}

                {/* Approve selected / Cancel */}
                <div className="px-6 pb-3 space-y-1.5">
                  {/* All-skipped warning — shown instead of the approve button being dimly disabled */}
                  {allSkipped && (
                    <p className="text-xs text-amber-500/80 text-center">
                      No files selected. Toggle at least one file to Include before approving.
                    </p>
                  )}
                  {chatApproveError && (
                    <p className="text-xs text-red-500/70 text-center">
                      {chatApproveError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleApproveAll()}
                      disabled={chatApproveAllLoading || allSkipped}
                      className="flex-1 text-xs py-1.5 rounded bg-green-900/20 text-green-400 border border-green-500/20 hover:bg-green-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {chatApproveAllLoading
                        ? "Writing…"
                        : `Approve selected ${selectedCount} file${selectedCount !== 1 ? "s" : ""}`}
                    </button>
                    <button
                      onClick={handleChatCancelProposal}
                      disabled={chatApproveAllLoading}
                      className="flex-1 text-xs py-1.5 rounded bg-slate-700/40 text-slate-400 border border-slate-600/30 hover:bg-slate-700/60 hover:text-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Agent plan panel ──────────────────────────────────────────────────
           Shown when the assistant response or user input contained a valid
           jarvis-agent-plan block.  Steps are managed manually — nothing runs
           automatically.  The panel is dismissed by the × button or a new send. */}
      {chatAgentPlan && (
        <div className="flex-shrink-0 border-t border-cyan-500/20 bg-cyan-900/5">
          {/* Panel header */}
          <div className="flex items-center justify-between px-6 py-2">
            <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
              <p className="text-xs font-semibold text-cyan-400 uppercase tracking-widest flex-shrink-0">
                Agent Plan
              </p>
              <span className="text-xs px-1.5 py-px rounded bg-cyan-500/10 text-cyan-500/80 border border-cyan-500/20 font-medium flex-shrink-0">
                {chatAgentPlan.steps.length} step{chatAgentPlan.steps.length !== 1 ? "s" : ""}
              </span>
              {/* Compact done count — full breakdown is in the progress summary below */}
              {chatAgentPlan.steps.some((s) => s.status === "done") && (
                <span className="text-xs text-green-500/60 flex-shrink-0">
                  {chatAgentPlan.steps.filter((s) => s.status === "done").length}/
                  {chatAgentPlan.steps.length}
                </span>
              )}
              {/* Active step indicator — shows which step is currently in progress */}
              {(() => {
                const activeStep = chatAgentPlan.steps.find((s) => s.status === "in_progress");
                return activeStep ? (
                  <span
                    className="text-xs text-amber-500/80 truncate"
                    title={`Current step: ${activeStep.title}`}
                  >
                    ▶ {activeStep.title}
                  </span>
                ) : null;
              })()}
            </div>
            <button
              type="button"
              onClick={handleClearPlan}
              className="text-slate-600 hover:text-slate-400 text-sm leading-none"
              aria-label="Clear plan"
              title="Dismiss this plan"
            >
              ×
            </button>
          </div>

          {/* Plan title + summary */}
          <div className="px-6 pb-2">
            <p className="text-sm font-medium text-slate-200">{chatAgentPlan.title}</p>
            {chatAgentPlan.summary && (
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                {chatAgentPlan.summary}
              </p>
            )}
          </div>

          {/* ── Progress summary ─────────────────────────────────────────────
               Derived from step statuses — no separate state needed.
               Updates immediately whenever a step is marked done/reset/active. */}
          {(() => {
            const totalSteps = chatAgentPlan.steps.length;
            const doneCount = chatAgentPlan.steps.filter(
              (s) => s.status === "done"
            ).length;
            const activeCount = chatAgentPlan.steps.filter(
              (s) => s.status === "in_progress"
            ).length;
            const plannedCount = chatAgentPlan.steps.filter(
              (s) => s.status === "planned"
            ).length;
            const blockedCount = chatAgentPlan.steps.filter(
              (s) => s.status === "blocked"
            ).length;
            const donePercent =
              totalSteps > 0
                ? Math.round((doneCount / totalSteps) * 100)
                : 0;

            // Build the stat parts, skipping zero-count optional items
            const parts: string[] = [`${doneCount}/${totalSteps} done`];
            if (activeCount > 0) parts.push(`${activeCount} active`);
            if (plannedCount > 0) parts.push(`${plannedCount} planned`);
            if (blockedCount > 0) parts.push(`${blockedCount} blocked`);

            return (
              <div className="px-6 pb-2">
                {/* Stat text row */}
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-slate-600 select-none">
                    {parts.map((part, i) => (
                      <span key={part}>
                        {i > 0 && (
                          <span className="mx-1 text-slate-700">·</span>
                        )}
                        <span
                          className={
                            part.includes("done") && doneCount > 0
                              ? "text-green-500/70"
                              : part.includes("active")
                              ? "text-amber-500/70"
                              : part.includes("blocked")
                              ? "text-red-500/60"
                              : "text-slate-500"
                          }
                        >
                          {part}
                        </span>
                      </span>
                    ))}
                  </p>
                  <span className="text-xs text-slate-700 select-none">
                    {donePercent}%
                  </span>
                </div>
                {/* Progress bar */}
                <div className="h-1 rounded-full bg-slate-700/50 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500/50 transition-all duration-300"
                    style={{ width: `${donePercent}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {/* Safety note — always visible to remind the user nothing runs automatically */}
          <div className="mx-6 mb-2 px-3 py-1.5 rounded bg-slate-800/60 border border-slate-700/40">
            <p className="text-xs text-slate-600 select-none">
              Planning only. Steps do not run automatically.
            </p>
          </div>

          {/* Step list — scrollable when there are many steps */}
          <div className="px-6 pb-3 space-y-1.5 overflow-y-auto" style={{ maxHeight: "260px" }}>
            {chatAgentPlan.steps.map((step, idx) => {
              const isDone = step.status === "done";
              const isBlocked = step.status === "blocked";
              const isInProgress = step.status === "in_progress";
              const rowBg = isDone
                ? "bg-green-900/10 border-green-700/30"
                : isBlocked
                ? "bg-red-900/10 border-red-700/30"
                : isInProgress
                // Stronger amber highlight for the active/current step
                ? "bg-amber-900/20 border-amber-500/50"
                : "bg-slate-800/40 border-slate-700/40";

              const statusBadge = isDone
                ? "bg-green-900/20 text-green-400 border-green-600/30"
                : isBlocked
                ? "bg-red-900/20 text-red-400 border-red-600/30"
                : isInProgress
                ? "bg-amber-900/20 text-amber-400 border-amber-600/30"
                : "bg-slate-700/30 text-slate-500 border-slate-600/30";

              return (
                <div key={step.id} className={`rounded border px-3 py-2 ${rowBg}`}>
                  <div className="flex items-start gap-2">
                    {/* Step index */}
                    <span className="text-xs text-slate-600 flex-shrink-0 mt-0.5 w-4 text-right select-none">
                      {idx + 1}.
                    </span>

                    {/* Step body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs font-medium ${isDone ? "text-green-400 line-through decoration-green-600/50" : "text-slate-200"}`}>
                          {step.title}
                        </span>
                        {/* Kind badge (analysis / code / docs / test / review) */}
                        {step.kind && (
                          <span className="text-xs px-1.5 py-px rounded bg-slate-700/60 text-slate-500 border border-slate-600/40 font-medium">
                            {step.kind}
                          </span>
                        )}
                        {/* Status badge */}
                        <span className={`text-xs px-1.5 py-px rounded border font-medium ${statusBadge}`}>
                          {step.status.replace("_", " ")}
                        </span>
                      </div>
                      {step.description && (
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                          {step.description}
                        </p>
                      )}

                      {/* ── Step note area ──────────────────────────────────
                           Notes are manual planning annotations.
                           They are never sent to the model. */}

                      {/* Saved note display — hidden while editing this step */}
                      {step.note && editingNoteStepId !== step.id && (
                        <div className="mt-1.5 px-2 py-1 rounded bg-slate-900/50 border border-slate-700/40">
                          <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                            <span className="text-slate-600 select-none">Note: </span>
                            {step.note}
                          </p>
                        </div>
                      )}

                      {/* Note editor — shown only for the step being edited */}
                      {editingNoteStepId === step.id ? (
                        <div className="mt-1.5 space-y-1">
                          <textarea
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value.slice(0, 1000))}
                            placeholder="Add a planning note…"
                            rows={2}
                            className="w-full text-xs bg-slate-800/60 border border-slate-600/50 rounded px-2 py-1 text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-500/40"
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleSaveStepNote(step.id)}
                              className="text-xs px-2 py-0.5 rounded bg-cyan-900/30 text-cyan-400 border border-cyan-600/30 hover:bg-cyan-900/50 transition-colors"
                            >
                              Save note
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelStepNote}
                              className="text-xs px-2 py-0.5 rounded bg-slate-700/40 text-slate-500 border border-slate-600/30 hover:bg-slate-700/60 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Note action buttons — Add / Edit + Clear · Ask Jarvis */
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          {step.note ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleEditStepNote(step.id)}
                                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
                              >
                                Edit note
                              </button>
                              <span className="text-slate-700 text-xs select-none">·</span>
                              <button
                                type="button"
                                onClick={() => handleClearStepNote(step.id)}
                                className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                              >
                                Clear note
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleEditStepNote(step.id)}
                              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
                            >
                              + Add note
                            </button>
                          )}
                          {/* Ask Jarvis — pre-fills chat input with a step prompt.
                               Does NOT send automatically. Does NOT change step state. */}
                          <span className="text-slate-700 text-xs select-none">·</span>
                          <button
                            type="button"
                            onClick={() => handleAskAboutStep(step.id)}
                            title="Pre-fill the chat input with a prompt about this step — does not send automatically"
                            className="text-xs text-cyan-700 hover:text-cyan-400 transition-colors"
                          >
                            Ask Jarvis
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Step action buttons (right column):
                         planned/blocked → Set active + Done
                         in_progress    → Done  (it's already the current step)
                         done           → Reset */}
                    <div className="flex-shrink-0 flex flex-col gap-1 items-end">
                      {isDone ? (
                        <button
                          type="button"
                          onClick={() => handleResetStep(step.id)}
                          title="Reset this step to planned"
                          className="text-xs px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-400 border border-slate-600/30 hover:bg-slate-700/60 transition-colors whitespace-nowrap"
                        >
                          Reset
                        </button>
                      ) : isInProgress ? (
                        /* Active step — just show Done; "Set active" not needed */
                        <button
                          type="button"
                          onClick={() => handleMarkStepDone(step.id)}
                          title="Mark this step as done"
                          className="text-xs px-1.5 py-0.5 rounded bg-green-900/20 text-green-400 border border-green-600/30 hover:bg-green-900/40 transition-colors whitespace-nowrap"
                        >
                          Done
                        </button>
                      ) : (
                        /* planned or blocked — offer Set active and Done */
                        <>
                          <button
                            type="button"
                            onClick={() => handleSetStepActive(step.id)}
                            title="Mark this step as the current active step"
                            className="text-xs px-1.5 py-0.5 rounded bg-amber-900/20 text-amber-400 border border-amber-600/30 hover:bg-amber-900/40 transition-colors whitespace-nowrap"
                          >
                            Set active
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkStepDone(step.id)}
                            title="Mark this step as done"
                            className="text-xs px-1.5 py-0.5 rounded bg-green-900/20 text-green-400 border border-green-600/30 hover:bg-green-900/40 transition-colors whitespace-nowrap"
                          >
                            Done
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={send} className="px-6 py-4 border-t border-slate-800">
        {/* Attachment pill — workspace file queued for the next message */}
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
              aria-label="Remove workspace attachment"
            >
              ×
            </button>
          </div>
        )}
        {/* Project file attachment pill — project library file queued for the next message */}
        {attachedProjectFile && (
          <div className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs">
            <span className="text-indigo-300 truncate">
              Project file:{" "}
              <span className="font-medium">
                {attachedProjectFile.projectName}/{attachedProjectFile.path}
              </span>
              <span className="text-indigo-500 ml-1">· Read-only · will be included in next message</span>
            </span>
            <button
              type="button"
              onClick={onClearAttachedProjectFile}
              className="flex-shrink-0 text-indigo-600 hover:text-indigo-300 leading-none"
              aria-label="Remove project file attachment"
            >
              ×
            </button>
          </div>
        )}

        {/* Memory context chip — shows when one or more memory notes are selected for this chat */}
        {memoryContext && memoryContext.length > 0 && (
          <div className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs">
            <span className="text-purple-300 truncate">
              Memory context:{" "}
              <span className="font-medium">
                {memoryContext.length} note{memoryContext.length !== 1 ? "s" : ""}
              </span>
              <span className="text-purple-500 ml-1">
                · {memoryContext.map((m) => m.title).join(", ")}
              </span>
              <span className="text-purple-700 ml-1">· this chat only</span>
            </span>
            <button
              type="button"
              onClick={onClearMemoryContext}
              className="flex-shrink-0 text-purple-600 hover:text-purple-300 leading-none"
              aria-label="Clear memory context for this chat"
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
          {/* Multi-file proposal template helper (v1.2.1).
              Copies the v2 jarvis-write-proposal template to clipboard.
              Fallback: inserts into input if clipboard is unavailable.
              Does not send automatically — approval is always required. */}
          <button
            type="button"
            onClick={() => void handleCopyMultiFileTemplate()}
            title="Copy a v2 multi-file write proposal template to clipboard. Paste into chat and edit paths/content, then Send."
            className={`text-xs transition-colors ${
              templateCopied
                ? "text-green-500/80"
                : "text-slate-700 hover:text-slate-400"
            }`}
          >
            {templateCopied ? "✓ Template copied" : "Copy multi-file template"}
          </button>
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
// Returns { before, after, paths, summary } so AssistantMessage can render a styled
// callout instead of the raw fenced block. Returns null when no proposal block is present.
// Handles both v1 (single path) and v2 (multiple paths with optional summary).
function parseProposalBlock(text: string): {
  before: string;
  after: string;
  paths: string[];
  summary: string;
} | null {
  const result = matchProposalBlock(text);
  if (!result) return null;
  const before = text.slice(0, result.index).trimEnd();
  const after = text.slice(result.index + result.fullMatch.length).trimStart();
  let paths: string[] = [];
  let summary = "";
  try {
    const parsed = JSON.parse(result.jsonBody) as unknown;
    if (isMultiFileProposal(parsed)) {
      // v2: extract all file paths and the optional summary
      paths = parsed.files.map((f) => f.path.trim()).filter(Boolean);
      summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    } else {
      // v1: single path field
      const v1 = parsed as { path?: unknown };
      if (typeof v1.path === "string" && v1.path.trim()) {
        paths = [v1.path.trim()];
      }
    }
  } catch {
    // JSON parse failed — callout still renders without path/summary info
  }
  return { before, after, paths, summary };
}

function AssistantMessage({
  text,
  showCursor,
  model,
}: {
  text: string;
  showCursor?: boolean;
  // The Ollama model that generated this response (from the "done" stream event
  // or loaded from persisted history). Undefined for the greeting and old messages.
  model?: string;
}) {
  const proposal = parseProposalBlock(text);

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0 text-cyan-400 text-xs font-bold">
        J
      </div>
      <div className="flex-1">
        {/* Message label — "Jarvis · <model>" when model is known */}
        <p className="text-xs text-cyan-400 font-medium mb-1">
          Jarvis
          {model && (
            <span className="font-normal text-slate-600 ml-1">· {model}</span>
          )}
        </p>

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
                    {proposal.paths.length > 1
                      ? `Jarvis proposed ${proposal.paths.length} workspace file changes`
                      : "Jarvis proposed a workspace file change"}
                  </p>
                  {/* Optional summary from v2 proposals */}
                  {proposal.summary && (
                    <p className="text-xs text-amber-600/80 mt-0.5 italic leading-relaxed">
                      {proposal.summary}
                    </p>
                  )}
                  {/* Single-file path */}
                  {proposal.paths.length === 1 && (
                    <p className="text-xs text-amber-600 mt-0.5 font-mono break-all">
                      workspace/{proposal.paths[0]}
                    </p>
                  )}
                  {/* Multi-file path list */}
                  {proposal.paths.length > 1 && (
                    <ul className="mt-0.5 space-y-0.5">
                      {proposal.paths.map((p, i) => (
                        <li key={i} className="text-xs text-amber-600 font-mono break-all">
                          workspace/{p}
                        </li>
                      ))}
                    </ul>
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

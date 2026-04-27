// Write-with-approval service for the Jarvis workspace.
// ALL writes are sandboxed to the allowed workspace and require explicit user approval.
// No write is ever applied without going through proposeWrite → approveWrite.

import { randomUUID } from "crypto";
import fs from "fs";
import { resolveWorkspacePath } from "./fileTools";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DiffLine = {
  type: "unchanged" | "added" | "removed";
  content: string;
};

interface WriteProposal {
  id: string;
  /** Relative path as supplied by the caller */
  path: string;
  /** Absolute validated path — stored for defense-in-depth re-check on approve */
  resolvedPath: string;
  before: string;
  after: string;
  diff: DiffLine[];
  createdAt: number;
}

// ─── Proposal store ────────────────────────────────────────────────────────────

// In-memory only — proposals are never written to disk.
// Proposals expire after 30 minutes to prevent unbounded memory growth.
// Maximum 20 concurrent proposals.
const writeProposals = new Map<string, WriteProposal>();
const PROPOSAL_TTL_MS = 30 * 60 * 1000;
const MAX_PROPOSALS = 20;

// Maximum size of the proposed content — mirrors the readTextFile limit.
const MAX_WRITE_SIZE = 200 * 1024;

function pruneExpiredProposals(): void {
  const now = Date.now();
  for (const [id, proposal] of writeProposals) {
    if (now - proposal.createdAt > PROPOSAL_TTL_MS) {
      writeProposals.delete(id);
    }
  }
}

// ─── Diff computation ──────────────────────────────────────────────────────────

/**
 * Computes a line-by-line diff using common prefix/suffix detection.
 * Handles append, prepend, replace, and delete operations without any external
 * dependency. Not a full LCS diff — sufficient for workspace editing use cases.
 */
function computeDiff(before: string, after: string): DiffLine[] {
  const beforeLines = before.length === 0 ? [] : before.split("\n");
  const afterLines = after.length === 0 ? [] : after.split("\n");

  // Find the length of the common leading prefix
  let prefixLen = 0;
  while (
    prefixLen < beforeLines.length &&
    prefixLen < afterLines.length &&
    beforeLines[prefixLen] === afterLines[prefixLen]
  ) {
    prefixLen++;
  }

  // Find the length of the common trailing suffix (must not overlap with prefix)
  let suffixLen = 0;
  while (
    suffixLen < beforeLines.length - prefixLen &&
    suffixLen < afterLines.length - prefixLen &&
    beforeLines[beforeLines.length - 1 - suffixLen] ===
      afterLines[afterLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const result: DiffLine[] = [];

  for (let i = 0; i < prefixLen; i++) {
    result.push({ type: "unchanged", content: beforeLines[i] });
  }
  for (let i = prefixLen; i < beforeLines.length - suffixLen; i++) {
    result.push({ type: "removed", content: beforeLines[i] });
  }
  for (let i = prefixLen; i < afterLines.length - suffixLen; i++) {
    result.push({ type: "added", content: afterLines[i] });
  }
  for (let i = beforeLines.length - suffixLen; i < beforeLines.length; i++) {
    result.push({ type: "unchanged", content: beforeLines[i] });
  }

  return result;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Validates the target path, reads the current file content, computes the diff,
 * and stores the proposal in the in-memory store.
 *
 * Throws if:
 *   - path escapes the workspace
 *   - file does not exist or is not a regular file
 *   - proposed content exceeds MAX_WRITE_SIZE
 *   - too many concurrent proposals exist
 *
 * @returns Proposal id, path, before/after strings, and computed diff lines.
 */
export function proposeWrite(
  relativePath: string,
  proposedContent: string
): {
  id: string;
  path: string;
  before: string;
  after: string;
  diff: DiffLine[];
} {
  pruneExpiredProposals();

  if (writeProposals.size >= MAX_PROPOSALS) {
    throw new Error(
      "Too many pending write proposals. Cancel or approve existing proposals first."
    );
  }

  // Validate path — throws if outside workspace
  const resolvedPath = resolveWorkspacePath(relativePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("File does not exist.");
  }
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error("Target path is not a regular file.");
  }

  if (Buffer.byteLength(proposedContent, "utf8") > MAX_WRITE_SIZE) {
    throw new Error(
      "Proposed content exceeds the maximum allowed size (200 KB)."
    );
  }

  const before = fs.readFileSync(resolvedPath, "utf-8");
  const after = proposedContent;
  const diff = computeDiff(before, after);
  const id = randomUUID();

  writeProposals.set(id, {
    id,
    path: relativePath,
    resolvedPath,
    before,
    after,
    diff,
    createdAt: Date.now(),
  });

  console.log(`[Jarvis] Write proposal created: ${id} → ${relativePath}`);

  return { id, path: relativePath, before, after, diff };
}

/**
 * Looks up a pending proposal by id, re-validates the target path,
 * and writes the approved content to disk.
 *
 * The proposal is deleted from the store after a successful write —
 * approving the same proposal a second time will always fail.
 *
 * Throws if:
 *   - proposal not found or expired
 *   - path re-validation fails (defense-in-depth)
 *   - the file write itself fails
 */
export function approveWrite(
  proposalId: string
): { path: string; written: boolean } {
  const proposal = writeProposals.get(proposalId);
  if (!proposal) {
    throw new Error(
      "Write proposal not found or expired. Please create a new proposal."
    );
  }

  // Defense-in-depth: re-resolve and re-validate the path at approval time.
  const resolvedPath = resolveWorkspacePath(proposal.path);
  if (resolvedPath !== proposal.resolvedPath) {
    writeProposals.delete(proposalId);
    throw new Error("Path validation mismatch. Proposal discarded for safety.");
  }

  fs.writeFileSync(resolvedPath, proposal.after, "utf-8");
  writeProposals.delete(proposalId);

  console.log(
    `[Jarvis] Write approved and applied: ${proposalId} → ${proposal.path}`
  );

  return { path: proposal.path, written: true };
}

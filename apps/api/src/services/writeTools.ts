// Write-with-approval service for the Jarvis workspace.
// ALL writes are sandboxed to the allowed workspace and require explicit user approval.
// No write is ever applied without going through proposeWrite → approveWrite.

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
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
  /** "edit" = file existed at proposal time; "create" = file did not exist */
  operation: "edit" | "create";
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
 * Validates the target path, reads the current file content (or uses "" for new files),
 * computes the diff, and stores the proposal in the in-memory store.
 *
 * Supports two operations:
 *   "edit"   — file exists; diff shows changes against current content.
 *   "create" — file does not exist; diff shows all lines as added.
 *              The parent directory must already exist.
 *
 * Throws if:
 *   - path escapes the workspace
 *   - target is an existing non-regular-file (e.g. a directory)
 *   - parent directory does not exist (for create proposals)
 *   - proposed content exceeds MAX_WRITE_SIZE
 *   - too many concurrent proposals exist
 *
 * @returns Proposal id, path, operation, before/after strings, and computed diff lines.
 */
export function proposeWrite(
  relativePath: string,
  proposedContent: string
): {
  id: string;
  path: string;
  operation: "edit" | "create";
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

  // Validate path — throws if outside workspace or contains traversal
  const resolvedPath = resolveWorkspacePath(relativePath);

  let before: string;
  let operation: "edit" | "create";

  if (!fs.existsSync(resolvedPath)) {
    // New file — parent directory must already exist inside the workspace
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
      throw new Error(
        "Parent directory does not exist. Create the directory first."
      );
    }
    before = "";
    operation = "create";
  } else {
    // Existing path — must be a regular file, not a directory
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error("Target path is not a regular file.");
    }
    before = fs.readFileSync(resolvedPath, "utf-8");
    operation = "edit";
  }

  if (Buffer.byteLength(proposedContent, "utf8") > MAX_WRITE_SIZE) {
    throw new Error(
      "Proposed content exceeds the maximum allowed size (200 KB)."
    );
  }

  const after = proposedContent;
  const diff = computeDiff(before, after);
  const id = randomUUID();

  writeProposals.set(id, {
    id,
    path: relativePath,
    resolvedPath,
    operation,
    before,
    after,
    diff,
    createdAt: Date.now(),
  });

  console.log(
    `[Jarvis] Write proposal created (${operation}): ${id} → ${relativePath}`
  );

  return { id, path: relativePath, operation, before, after, diff };
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
): { path: string; operation: "edit" | "create"; written: boolean } {
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

  // fs.writeFileSync creates the file if it does not exist (create operation)
  // and overwrites it if it does (edit operation). The parent directory must
  // already exist — proposeWrite verified this at proposal creation time.
  fs.writeFileSync(resolvedPath, proposal.after, "utf-8");
  writeProposals.delete(proposalId);

  console.log(
    `[Jarvis] Write approved and applied (${proposal.operation}): ${proposalId} → ${proposal.path}`
  );

  return { path: proposal.path, operation: proposal.operation, written: true };
}

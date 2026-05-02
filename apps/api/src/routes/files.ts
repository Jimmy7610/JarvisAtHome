// Read-only file tool routes.
// All operations are sandboxed to the allowed workspace (config.allowedWorkspace).
// No write, edit, delete, or move endpoints exist in this router.
// All endpoints return HTTP 200; check the `ok` field for success/failure.

import { Router, Request, Response } from "express";
import {
  getAllowedWorkspace,
  listFiles,
  readTextFile,
  scanWorkspaceOverview,
} from "../services/fileTools";
import { proposeWrite, approveWrite } from "../services/writeTools";
import path from "path";

const router = Router();

// GET /files/list?path=optional-relative-path
// Lists the contents of a workspace directory.
// Defaults to the workspace root if no path is provided.
// Returns: { ok: true, root: "workspace", path: "...", entries: [...] }
// Returns: { ok: false, error: "..." } if path escapes workspace or does not exist.
router.get("/list", (req: Request, res: Response) => {
  const relativePath =
    typeof req.query.path === "string" ? req.query.path.trim() : "";

  try {
    const entries = listFiles(relativePath);
    const workspace = getAllowedWorkspace();
    const workspaceName = path.basename(workspace);

    res.json({
      ok: true,
      root: workspaceName,
      path: relativePath,
      entries,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.json({ ok: false, error: message });
  }
});

// GET /files/read?path=relative-file-path
// Reads a text file from the workspace.
// Returns: { ok: true, path: "...", content: "...", size: 1234 }
// Returns: { ok: false, error: "..." } if path is invalid, binary, or too large.
router.get("/read", (req: Request, res: Response) => {
  const relativePath =
    typeof req.query.path === "string" ? req.query.path.trim() : "";

  if (!relativePath) {
    res.json({ ok: false, error: "path query parameter is required." });
    return;
  }

  try {
    const { content, size } = readTextFile(relativePath);
    res.json({ ok: true, path: relativePath, content, size });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.json({ ok: false, error: message });
  }
});

// GET /files/overview
// Recursively scans the workspace and returns aggregated metadata.
// No file contents are returned.  All paths are workspace-relative.
// The scan is capped at OVERVIEW_MAX_FILES (2000) files to stay fast.
// Returns: { ok: true, totalFiles, totalDirectories, extensions, largestFiles,
//            recentFiles, hints, scannedFiles, capped }
// Returns: { ok: false, error: "..." } if the scan fails.
router.get("/overview", (_req: Request, res: Response) => {
  try {
    const overview = scanWorkspaceOverview();
    res.json({ ok: true, ...overview });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.json({ ok: false, error: message });
  }
});

// POST /files/propose-write
// Validates the target path, reads the current content, computes a diff, and
// stores a pending proposal in the server-side in-memory store.
// Nothing is written to disk at this stage.
// Returns: { ok: true, id, path, before, after, diff }
// Returns: { ok: false, error } if path is invalid, file is missing, etc.
router.post("/propose-write", (req: Request, res: Response) => {
  const body = req.body as { path?: unknown; content?: unknown };

  const relativePath =
    typeof body.path === "string" ? body.path.trim() : "";
  const content =
    typeof body.content === "string" ? body.content : null;

  if (!relativePath) {
    res.json({ ok: false, error: "path is required." });
    return;
  }
  if (content === null) {
    res.json({ ok: false, error: "content is required." });
    return;
  }

  try {
    const result = proposeWrite(relativePath, content);
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.json({ ok: false, error: message });
  }
});

// POST /files/approve-write
// Looks up a pending proposal by id, re-validates the path, and writes the
// approved content to disk. The proposal is consumed and cannot be approved twice.
// Returns: { ok: true, path, written: true }
// Returns: { ok: false, error } if proposal not found, expired, or write fails.
router.post("/approve-write", (req: Request, res: Response) => {
  const body = req.body as { proposalId?: unknown };

  const proposalId =
    typeof body.proposalId === "string" ? body.proposalId.trim() : "";

  if (!proposalId) {
    res.json({ ok: false, error: "proposalId is required." });
    return;
  }

  try {
    const result = approveWrite(proposalId);
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.json({ ok: false, error: message });
  }
});

export default router;

// Read-only file tool routes.
// All operations are sandboxed to the allowed workspace (config.allowedWorkspace).
// No write, edit, delete, or move endpoints exist in this router.
// All endpoints return HTTP 200; check the `ok` field for success/failure.

import { Router, Request, Response } from "express";
import {
  getAllowedWorkspace,
  listFiles,
  readTextFile,
} from "../services/fileTools";
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

export default router;

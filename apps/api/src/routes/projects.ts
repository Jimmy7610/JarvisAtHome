// Read-only project library routes.
// All operations are sandboxed to <allowedWorkspace>/projects/.
// No write, edit, delete, or move endpoints exist in this router.
// All endpoints return HTTP 200; check the `ok` field for success/failure.

import { Router, Request, Response } from "express";
import {
  listProjects,
  listProjectFiles,
  readProjectFile,
  getProjectsRoot,
} from "../services/projectTools";
import path from "path";

const router = Router();

// GET /projects
// Lists all projects (top-level directories) inside workspace/projects/.
// Returns: { ok: true, projectsRoot: "projects", projects: [...] }
// Returns: { ok: false, error: "..." } on unexpected error.
router.get("/", (_req: Request, res: Response) => {
  try {
    const projects = listProjects();
    const projectsRoot = path.basename(getProjectsRoot());

    res.json({
      ok: true,
      projectsRoot,
      projects,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.json({ ok: false, error: message });
  }
});

// GET /projects/:projectName
// Lists the readable files inside a project directory (recursive, text files only).
// Returns: { ok: true, project: "my-project", files: [...] }
// Returns: { ok: false, error: "..." } if project does not exist or name is invalid.
router.get("/:projectName", (req: Request, res: Response) => {
  const { projectName } = req.params;

  try {
    const files = listProjectFiles(projectName);

    res.json({
      ok: true,
      project: projectName,
      files,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.json({ ok: false, error: message });
  }
});

// GET /projects/:projectName/file?path=relative-file-path
// Reads a text file from inside a project directory.
// Returns: { ok: true, project: "my-project", path: "src/index.ts", content: "...", size: 1234 }
// Returns: { ok: false, error: "..." } if path is invalid, binary, or too large.
router.get("/:projectName/file", (req: Request, res: Response) => {
  const { projectName } = req.params;
  const relativePath =
    typeof req.query.path === "string" ? req.query.path.trim() : "";

  if (!relativePath) {
    res.json({ ok: false, error: "path query parameter is required." });
    return;
  }

  try {
    const { content, size } = readProjectFile(projectName, relativePath);

    res.json({
      ok: true,
      project: projectName,
      path: relativePath,
      content,
      size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.json({ ok: false, error: message });
  }
});

export default router;

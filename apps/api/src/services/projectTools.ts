// Read-only project library service for the Jarvis Project Library.
// ALL operations are sandboxed to <allowedWorkspace>/projects/.
// No writes, no deletes, no moves. List and read only.

import fs from "fs";
import path from "path";
import { config } from "../config";

// Projects root is a fixed subdirectory of the allowed workspace.
// It cannot be overridden by environment variables — only the workspace root can.
const PROJECTS_ROOT = path.join(config.allowedWorkspace, "projects");

// Maximum file size that readProjectFile will accept (200 KB)
const MAX_FILE_SIZE = 200 * 1024;

// Maximum number of files returned per project listing
const MAX_FILES = 500;

// File extensions that are considered readable text.
// Binary files, compiled assets, and large data blobs are excluded.
const ALLOWED_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".html",
  ".htm",
  ".yml",
  ".yaml",
  ".env.example",
  ".sh",
  ".ps1",
  ".mjs",
  ".cjs",
]);

// Directory names that are always skipped during project file listing.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "local-tts",
  ".turbo",
  "coverage",
  "out",
  ".cache",
]);

// ─── Projects root access ─────────────────────────────────────────────────────

/** Returns the absolute path to the projects root directory. */
export function getProjectsRoot(): string {
  return PROJECTS_ROOT;
}

/**
 * Resolves and validates a project name.
 * A valid project name:
 *   - Is a single path segment (no slashes, no "..")
 *   - Is not empty
 *   - Resolves to a directory directly inside PROJECTS_ROOT
 *
 * Throws if the name is invalid or escapes the projects root.
 *
 * @param projectName - The raw project name from the request.
 * @returns Absolute path to the project directory.
 */
export function resolveProjectDir(projectName: string): string {
  if (!projectName || typeof projectName !== "string") {
    throw new Error("Project name is required.");
  }

  // Reject anything that looks like a path traversal attempt
  if (
    projectName.includes("/") ||
    projectName.includes("\\") ||
    projectName.includes("..")
  ) {
    throw new Error("Project name must be a single directory name (no slashes or ..).");
  }

  // Reject hidden directories
  if (projectName.startsWith(".")) {
    throw new Error("Project name must not start with a dot.");
  }

  const resolved = path.resolve(PROJECTS_ROOT, projectName);

  // Confirm the resolved path is exactly one level inside PROJECTS_ROOT
  const projectsRootWithSep = PROJECTS_ROOT.endsWith(path.sep)
    ? PROJECTS_ROOT
    : PROJECTS_ROOT + path.sep;

  if (!resolved.startsWith(projectsRootWithSep)) {
    throw new Error("Project path escapes the projects root.");
  }

  return resolved;
}

/**
 * Resolves a relative file path inside a project directory.
 * Throws if the path escapes the project directory.
 *
 * @param projectDir - Absolute path to the project directory (from resolveProjectDir).
 * @param relativePath - Relative path to a file inside the project.
 * @returns Absolute path to the file.
 */
export function resolveProjectFilePath(
  projectDir: string,
  relativePath: string
): string {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("File path is required.");
  }

  // Normalise separators and strip leading slashes
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  const resolved = path.resolve(projectDir, cleaned);

  // The resolved path must remain inside the project directory
  const projectDirWithSep = projectDir.endsWith(path.sep)
    ? projectDir
    : projectDir + path.sep;

  if (resolved !== projectDir && !resolved.startsWith(projectDirWithSep)) {
    throw new Error("File path escapes the project directory.");
  }

  return resolved;
}

// ─── Directory listing ─────────────────────────────────────────────────────────

export type ProjectEntry = {
  name: string;
  /** Path relative to the projects root, forward-slash separated */
  path: string;
  type: "file" | "directory";
  /** Present for files; omitted for directories */
  size?: number;
};

/**
 * Lists all projects (top-level directories) inside the projects root.
 * Hidden directories are excluded.
 * Returns an empty array if the projects root does not exist yet.
 */
export function listProjects(): ProjectEntry[] {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    return [];
  }

  const stat = fs.statSync(PROJECTS_ROOT);
  if (!stat.isDirectory()) {
    throw new Error("Projects root exists but is not a directory.");
  }

  const names = fs.readdirSync(PROJECTS_ROOT);
  const entries: ProjectEntry[] = [];

  for (const name of names) {
    // Skip hidden directories
    if (name.startsWith(".")) continue;

    const fullPath = path.join(PROJECTS_ROOT, name);

    let entryStat: fs.Stats;
    try {
      entryStat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (!entryStat.isDirectory()) continue;

    entries.push({
      name,
      path: name,
      type: "directory",
    });
  }

  return entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/**
 * Lists the readable text files in a project directory, recursively.
 * Skips hidden files, SKIP_DIRS, and files with non-allowed extensions.
 * Caps at MAX_FILES entries.
 *
 * @param projectName - The project directory name.
 * @returns A flat list of file entries with paths relative to the project directory.
 */
export function listProjectFiles(projectName: string): ProjectEntry[] {
  const projectDir = resolveProjectDir(projectName);

  if (!fs.existsSync(projectDir)) {
    throw new Error(`Project "${projectName}" does not exist.`);
  }

  const stat = fs.statSync(projectDir);
  if (!stat.isDirectory()) {
    throw new Error(`"${projectName}" is not a directory.`);
  }

  const results: ProjectEntry[] = [];

  function walk(dir: string, relBase: string): void {
    if (results.length >= MAX_FILES) return;

    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }

    // Sort directories first, then files
    const sorted = names.sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    for (const name of sorted) {
      if (results.length >= MAX_FILES) break;

      // Skip hidden entries
      if (name.startsWith(".")) continue;

      const fullPath = path.join(dir, name);

      let entryStat: fs.Stats;
      try {
        entryStat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      const relPath = relBase ? `${relBase}/${name}` : name;

      if (entryStat.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        // Recurse — include directory entry for tree display
        results.push({ name, path: relPath, type: "directory" });
        walk(fullPath, relPath);
      } else if (entryStat.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) continue;
        results.push({
          name,
          path: relPath,
          type: "file",
          size: entryStat.size,
        });
      }
    }
  }

  walk(projectDir, "");

  return results;
}

// ─── File reading ──────────────────────────────────────────────────────────────

/**
 * Returns true if the buffer is likely binary (contains a null byte in the first 512 bytes).
 */
function isBinary(buffer: Buffer): boolean {
  const checkLen = Math.min(512, buffer.length);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Reads a text file from inside a project directory.
 * Throws if: path escapes the project, file does not exist, file is a directory,
 *            file exceeds MAX_FILE_SIZE, file extension is not allowed, or file
 *            appears to be binary.
 *
 * @param projectName - The project directory name (from the URL parameter).
 * @param relativePath - Path relative to the project directory root.
 * @returns File content as a UTF-8 string and the file size in bytes.
 */
export function readProjectFile(
  projectName: string,
  relativePath: string
): { content: string; size: number } {
  const projectDir = resolveProjectDir(projectName);
  const resolved = resolveProjectFilePath(projectDir, relativePath);

  // Check the extension is allowed
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `File type "${ext}" is not readable. Only text files are supported.`
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error("File does not exist.");
  }

  const stat = fs.statSync(resolved);

  if (!stat.isFile()) {
    throw new Error("Path is not a file.");
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File is too large (${stat.size} bytes). Maximum allowed size is ${MAX_FILE_SIZE} bytes (200 KB).`
    );
  }

  const buffer = fs.readFileSync(resolved);

  if (isBinary(buffer)) {
    throw new Error(
      "Binary files cannot be read. Only UTF-8 text files are supported."
    );
  }

  return { content: buffer.toString("utf-8"), size: stat.size };
}

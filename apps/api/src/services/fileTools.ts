// Read-only file service for the Jarvis workspace.
// ALL operations are sandboxed to config.allowedWorkspace.
// No writes, no deletes, no moves. Read and list only.

import fs from "fs";
import path from "path";
import { config } from "../config";

// Maximum file size that readTextFile will accept (200 KB)
const MAX_FILE_SIZE = 200 * 1024;

// Directory names that are always skipped during listing, regardless of depth.
// These are either build artifacts, package trees, or sensitive runtime data.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "data",
  ".turbo",
  "coverage",
  "out",
]);

// ─── Workspace access ──────────────────────────────────────────────────────────

/** Returns the absolute path to the allowed workspace directory. */
export function getAllowedWorkspace(): string {
  return config.allowedWorkspace;
}

/**
 * Resolves a caller-supplied relative path against the allowed workspace.
 * Throws if the resolved path escapes the workspace (path traversal attack).
 *
 * @param relativePath - A relative path like "subdir/file.md". Must not be absolute.
 * @returns The absolute, safe path inside the workspace.
 */
export function resolveWorkspacePath(relativePath: string): string {
  const workspace = getAllowedWorkspace();

  // Normalise separators and strip any leading slashes so path.resolve works
  // correctly regardless of OS or caller-supplied format.
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  const resolved = path.resolve(workspace, cleaned);

  // The resolved path must start with workspace + sep (or equal workspace itself)
  // to guarantee no traversal above the root.
  const workspaceWithSep = workspace.endsWith(path.sep)
    ? workspace
    : workspace + path.sep;

  if (resolved !== workspace && !resolved.startsWith(workspaceWithSep)) {
    throw new Error("Path is outside the allowed workspace.");
  }

  return resolved;
}

// ─── Directory listing ─────────────────────────────────────────────────────────

export type FileEntry = {
  name: string;
  /** Path relative to the workspace root, forward-slash separated */
  path: string;
  type: "file" | "directory";
  /** Present for files; omitted for directories */
  size?: number;
};

/**
 * Lists the contents of a workspace directory.
 * Hidden entries (names starting with ".") and entries in SKIP_DIRS are excluded.
 * Directories appear before files; entries are sorted alphabetically within each group.
 *
 * @param relativePath - Path relative to workspace root. Defaults to root ("").
 */
export function listFiles(relativePath: string = ""): FileEntry[] {
  const workspace = getAllowedWorkspace();

  const targetPath =
    relativePath === "" ? workspace : resolveWorkspacePath(relativePath);

  if (!fs.existsSync(targetPath)) {
    throw new Error("Path does not exist.");
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw new Error("Path is not a directory.");
  }

  const names = fs.readdirSync(targetPath);
  const entries: FileEntry[] = [];

  for (const name of names) {
    // Skip hidden files and directories (names starting with ".")
    if (name.startsWith(".")) continue;

    const fullPath = path.join(targetPath, name);

    let entryStat: fs.Stats;
    try {
      entryStat = fs.statSync(fullPath);
    } catch {
      // Skip entries that can't be stat-ed (e.g. broken symlinks)
      continue;
    }

    const relPath = path
      .relative(workspace, fullPath)
      .replace(/\\/g, "/");

    if (entryStat.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      entries.push({ name, path: relPath, type: "directory" });
    } else if (entryStat.isFile()) {
      entries.push({ name, path: relPath, type: "file", size: entryStat.size });
    }
    // Symlinks and other special entries are silently ignored
  }

  // Sort: directories first, then files; alphabetically within each group
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

// ─── File reading ──────────────────────────────────────────────────────────────

/**
 * Returns true if the buffer is likely binary (contains a null byte in the first 512 bytes).
 * This is a fast heuristic — not a perfect MIME detector, but reliable enough for text files.
 */
function isBinary(buffer: Buffer): boolean {
  const checkLen = Math.min(512, buffer.length);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Reads a text file from the workspace.
 * Throws if: path escapes workspace, file does not exist, file is a directory,
 *            file exceeds MAX_FILE_SIZE, or file appears to be binary.
 *
 * @param relativePath - Path relative to workspace root.
 * @returns File content as a UTF-8 string and the file size in bytes.
 */
export function readTextFile(
  relativePath: string
): { content: string; size: number } {
  const resolved = resolveWorkspacePath(relativePath);

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

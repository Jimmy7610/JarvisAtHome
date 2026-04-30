// Memory routes — manual user-created notes/preferences stored in local SQLite.
//
// SAFETY CONTRACT:
//   - All memory is created or edited only through explicit user action.
//   - The model/AI cannot write or edit memory autonomously.
//   - Memory is injected into chat only when the user explicitly opts-in per note.
//   - No secrets are accepted or stored (client responsibility, server does not log content).
//
// Endpoints:
//   GET    /memory              — list all memories, pinned first then newest first
//   POST   /memory              — create a new memory note
//   PATCH  /memory/:id/pinned   — toggle pinned state (must come before /:id route)
//   PATCH  /memory/:id          — update an existing memory note (title, content, type)
//   DELETE /memory/:id          — delete a memory note by id

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import db from "../services/db";

const router = Router();

// Allowed memory types — must match the CHECK constraint in db.ts
const ALLOWED_TYPES = ["preference", "project", "note"] as const;
type MemoryType = (typeof ALLOWED_TYPES)[number];

// Character limits — generous but not unlimited
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 2000;

// Row type matching the schema.
// pinned is a SQLite INTEGER (0 = unpinned, 1 = pinned).
// The frontend receives this as a number and converts to boolean for display.
type MemoryRow = {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  pinned: number;   // 0 | 1
  created_at: string;
  updated_at: string;
};

// GET /memory
// Returns all memory notes — pinned notes first, then newest first within each group.
// Returns: { ok: true, memories: MemoryRow[] }
router.get("/", (_req: Request, res: Response) => {
  const memories = db
    .prepare(
      `SELECT id, type, title, content, pinned, created_at, updated_at
       FROM memories
       ORDER BY pinned DESC, created_at DESC`
    )
    .all() as MemoryRow[];

  res.json({ ok: true, memories });
});

// POST /memory
// Creates a new memory note. Only user-initiated — never called by the AI.
// Body: { type: "preference" | "project" | "note", title: string, content: string }
// Returns: { ok: true, memory: MemoryRow }
router.post("/", (req: Request, res: Response) => {
  const { type, title, content } = req.body as {
    type?: unknown;
    title?: unknown;
    content?: unknown;
  };

  // Validate type
  if (typeof type !== "string" || !ALLOWED_TYPES.includes(type as MemoryType)) {
    res.json({
      ok: false,
      error: `type must be one of: ${ALLOWED_TYPES.join(", ")}.`,
    });
    return;
  }

  // Validate title
  if (typeof title !== "string" || title.trim() === "") {
    res.json({ ok: false, error: "title must be a non-empty string." });
    return;
  }
  const safeTitle = title.trim().slice(0, MAX_TITLE_LENGTH);

  // Validate content
  if (typeof content !== "string" || content.trim() === "") {
    res.json({ ok: false, error: "content must be a non-empty string." });
    return;
  }
  const safeContent = content.trim().slice(0, MAX_CONTENT_LENGTH);

  const id = randomUUID();

  const memory = db
    .prepare(
      `INSERT INTO memories (id, type, title, content)
       VALUES (?, ?, ?, ?)
       RETURNING id, type, title, content, pinned, created_at, updated_at`
    )
    .get(id, type, safeTitle, safeContent) as MemoryRow;

  res.json({ ok: true, memory });
});

// PATCH /memory/:id/pinned
// Toggles the pinned (favorite) state of a memory note. Only user-initiated.
// Pinned status is a manual organisation tool — it does NOT automatically include
// the memory in chat context.  "Include in this chat" remains a separate action.
// Body: { pinned: boolean }
// Returns: { ok: true, memory: MemoryRow }
// Returns 404 if the memory does not exist.
//
// IMPORTANT: this route is registered before PATCH /:id so Express does not
// interpret "pinned" as the :id parameter.
router.patch("/:id/pinned", (req: Request, res: Response) => {
  const { id } = req.params;

  if (typeof id !== "string" || id.trim() === "") {
    res.json({ ok: false, error: "Invalid memory id." });
    return;
  }

  const existing = db
    .prepare("SELECT id FROM memories WHERE id = ?")
    .get(id) as { id: string } | undefined;

  if (!existing) {
    res.status(404).json({ ok: false, error: "Memory not found." });
    return;
  }

  const { pinned } = req.body as { pinned?: unknown };

  if (typeof pinned !== "boolean") {
    res.json({ ok: false, error: "pinned must be a boolean." });
    return;
  }

  // Store as SQLite INTEGER (0/1).  updated_at changes on every pin toggle.
  const updated = db
    .prepare(
      `UPDATE memories
       SET pinned     = ?,
           updated_at = datetime('now')
       WHERE id = ?
       RETURNING id, type, title, content, pinned, created_at, updated_at`
    )
    .get(pinned ? 1 : 0, id) as MemoryRow;

  res.json({ ok: true, memory: updated });
});

// PATCH /memory/:id
// Updates an existing memory note. Only user-initiated — never called by the AI.
// Body: { type: "preference" | "project" | "note", title: string, content: string }
// Returns: { ok: true, memory: MemoryRow }
// Returns 404 if the memory does not exist.
router.patch("/:id", (req: Request, res: Response) => {
  const { id } = req.params;

  // Basic id guard
  if (typeof id !== "string" || id.trim() === "") {
    res.json({ ok: false, error: "Invalid memory id." });
    return;
  }

  // Check the record exists before attempting an update
  const existing = db
    .prepare("SELECT id FROM memories WHERE id = ?")
    .get(id) as { id: string } | undefined;

  if (!existing) {
    res.status(404).json({ ok: false, error: "Memory not found." });
    return;
  }

  const { type, title, content } = req.body as {
    type?: unknown;
    title?: unknown;
    content?: unknown;
  };

  // Validate type
  if (typeof type !== "string" || !ALLOWED_TYPES.includes(type as MemoryType)) {
    res.json({
      ok: false,
      error: `type must be one of: ${ALLOWED_TYPES.join(", ")}.`,
    });
    return;
  }

  // Validate title
  if (typeof title !== "string" || title.trim() === "") {
    res.json({ ok: false, error: "title must be a non-empty string." });
    return;
  }
  const safeTitle = title.trim().slice(0, MAX_TITLE_LENGTH);

  // Validate content
  if (typeof content !== "string" || content.trim() === "") {
    res.json({ ok: false, error: "content must be a non-empty string." });
    return;
  }
  const safeContent = content.trim().slice(0, MAX_CONTENT_LENGTH);

  // Update the record and return the updated row.
  // updated_at is set explicitly to the current UTC timestamp.
  // pinned is preserved — editing a note does not change its pinned state.
  // Content is NOT logged here — only the id and title would be safe to log.
  const updated = db
    .prepare(
      `UPDATE memories
       SET type       = ?,
           title      = ?,
           content    = ?,
           updated_at = datetime('now')
       WHERE id = ?
       RETURNING id, type, title, content, pinned, created_at, updated_at`
    )
    .get(type, safeTitle, safeContent, id) as MemoryRow;

  res.json({ ok: true, memory: updated });
});

// DELETE /memory/:id
// Deletes a memory note by its UUID. Only user-initiated.
// Returns: { ok: true, deletedId: string }
router.delete("/:id", (req: Request, res: Response) => {
  const { id } = req.params;

  // Basic UUID format guard — not security-critical but prevents bad queries
  if (typeof id !== "string" || id.trim() === "") {
    res.json({ ok: false, error: "Invalid memory id." });
    return;
  }

  const existing = db
    .prepare("SELECT id FROM memories WHERE id = ?")
    .get(id) as { id: string } | undefined;

  if (!existing) {
    res.json({ ok: false, error: "Memory not found." });
    return;
  }

  db.prepare("DELETE FROM memories WHERE id = ?").run(id);

  res.json({ ok: true, deletedId: id });
});

export default router;

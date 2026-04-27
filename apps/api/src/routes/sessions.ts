// Session and message persistence routes.
// All endpoints return HTTP 200; check the `ok` field for success/failure.

import { Router, Request, Response } from "express";
import db from "../services/db";

const router = Router();

// Maximum character length accepted for message content
const MAX_CONTENT_LENGTH = 20_000;
const ALLOWED_ROLES = ["user", "assistant", "error", "cancelled"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

// Row types matching the schema
type SessionRow = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: number;
  session_id: number;
  role: AllowedRole;
  content: string;
  model: string | null;
  created_at: string;
};

// POST /sessions
// Creates a new chat session.
// Body (optional): { "title": "string" }
// Returns: { ok: true, session: { id, title, created_at, updated_at } }
router.post("/", (req: Request, res: Response) => {
  const { title } = req.body as { title?: unknown };
  const sessionTitle =
    typeof title === "string" && title.trim() !== ""
      ? title.trim().slice(0, 255)
      : "New Chat";

  const session = db
    .prepare(
      `INSERT INTO chat_sessions (title)
       VALUES (?)
       RETURNING id, title, created_at, updated_at`
    )
    .get(sessionTitle) as SessionRow;

  res.json({ ok: true, session });
});

// GET /sessions
// Returns the 50 most recently active sessions.
// Returns: { ok: true, sessions: [...] }
router.get("/", (_req: Request, res: Response) => {
  const sessions = db
    .prepare(
      `SELECT id, title, created_at, updated_at
       FROM chat_sessions
       ORDER BY updated_at DESC
       LIMIT 50`
    )
    .all() as SessionRow[];

  res.json({ ok: true, sessions });
});

// GET /sessions/:id
// Returns a session and all its messages ordered by creation time.
// Useful for testing Phase 1 and will be the primary read endpoint in Phase 2.
// Returns: { ok: true, session: {...}, messages: [...] }
router.get("/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.json({ ok: false, error: "Invalid session id." });
    return;
  }

  const session = db
    .prepare(
      `SELECT id, title, created_at, updated_at
       FROM chat_sessions
       WHERE id = ?`
    )
    .get(id) as SessionRow | undefined;

  if (!session) {
    res.json({ ok: false, error: "Session not found." });
    return;
  }

  const messages = db
    .prepare(
      `SELECT id, session_id, role, content, model, created_at
       FROM chat_messages
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(id) as MessageRow[];

  res.json({ ok: true, session, messages });
});

// POST /sessions/:id/messages
// Appends one message to a session and updates session.updated_at.
// Body: { role, content, model? }
// Returns: { ok: true, message: { id, session_id, role, content, model, created_at } }
router.post("/:id/messages", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.json({ ok: false, error: "Invalid session id." });
    return;
  }

  const { role, content, model } = req.body as {
    role?: unknown;
    content?: unknown;
    model?: unknown;
  };

  // Validate role
  if (
    typeof role !== "string" ||
    !ALLOWED_ROLES.includes(role as AllowedRole)
  ) {
    res.json({
      ok: false,
      error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}.`,
    });
    return;
  }

  // Validate content
  if (typeof content !== "string" || content.trim() === "") {
    res.json({ ok: false, error: "content must be a non-empty string." });
    return;
  }
  const safeContent = content.slice(0, MAX_CONTENT_LENGTH);

  // Validate model (optional string)
  const safeModel =
    typeof model === "string" && model.trim() !== "" ? model.trim() : null;

  // Verify the session exists
  const sessionExists = db
    .prepare("SELECT id FROM chat_sessions WHERE id = ?")
    .get(id);

  if (!sessionExists) {
    res.json({ ok: false, error: "Session not found." });
    return;
  }

  // Insert message and touch updated_at in a single transaction
  const insertAndTouch = db.transaction((): MessageRow => {
    const msg = db
      .prepare(
        `INSERT INTO chat_messages (session_id, role, content, model)
         VALUES (?, ?, ?, ?)
         RETURNING id, session_id, role, content, model, created_at`
      )
      .get(id, role, safeContent, safeModel) as MessageRow;

    db.prepare(
      `UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?`
    ).run(id);

    return msg;
  });

  const message = insertAndTouch();
  res.json({ ok: true, message });
});

// PATCH /sessions/:id
// Updates the session title (used for auto-titling from the first user message).
// Body: { "title": "string" }
// Returns: { ok: true, session: { id, title, created_at, updated_at } }
router.patch("/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.json({ ok: false, error: "Invalid session id." });
    return;
  }

  const { title } = req.body as { title?: unknown };
  if (typeof title !== "string" || title.trim() === "") {
    res.json({ ok: false, error: "title must be a non-empty string." });
    return;
  }
  const safeTitle = title.trim().slice(0, 80);

  const session = db
    .prepare(
      `UPDATE chat_sessions
       SET title = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING id, title, created_at, updated_at`
    )
    .get(safeTitle, id) as SessionRow | undefined;

  if (!session) {
    res.json({ ok: false, error: "Session not found." });
    return;
  }

  res.json({ ok: true, session });
});

// DELETE /sessions/:id
// Deletes a session and all its messages (messages removed via ON DELETE CASCADE).
// Returns: { ok: true, deletedSessionId: 123 }
// Returns: { ok: false, error: "..." } if id is invalid or session not found.
router.delete("/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.json({ ok: false, error: "Invalid session id." });
    return;
  }

  const session = db
    .prepare("SELECT id FROM chat_sessions WHERE id = ?")
    .get(id);

  if (!session) {
    res.json({ ok: false, error: "Session not found." });
    return;
  }

  db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);

  res.json({ ok: true, deletedSessionId: id });
});

export default router;

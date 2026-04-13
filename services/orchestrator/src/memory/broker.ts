/**
 * Memory Broker — persistent learning + self-improvement system.
 *
 * Tables:
 *   memories     — long-term knowledge (facts, episodes, preferences)
 *   turns        — conversation history (per session)
 *   profile      — key-value user profile
 *   adaptations  — JARVIS's self-written behavioral notes per user
 *   scores       — interaction quality scores for self-improvement
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Memory {
  id: number;
  kind: "working" | "episodic" | "semantic" | "profile" | "emotional";
  content: string;
  tags: string;
  salience: number;
  emotion: number;
  user_id: string;
  created_at: number;
  last_accessed: number;
}

export interface Adaptation {
  id: number;
  user_id: string;
  category: "preference" | "correction" | "style" | "behavior" | "self_note";
  content: string;
  confidence: number;
  created_at: number;
}

export interface InteractionScore {
  id: number;
  user_id: string;
  session_id: string;
  user_text: string;
  assistant_text: string;
  score: number;
  signal: string;
  created_at: number;
}

export class MemoryBroker {
  private db!: Database.Database;

  constructor(private path: string) {}

  async init() {
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new Database(this.path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '',
        salience REAL DEFAULT 0.5,
        emotion REAL DEFAULT 0.0,
        user_id TEXT DEFAULT 'global',
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);

      CREATE TABLE IF NOT EXISTS turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT DEFAULT 'global',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        affect TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_turns_user ON turns(user_id, created_at);

      CREATE TABLE IF NOT EXISTS profile (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS adaptations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL DEFAULT 0.7,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_adapt_user ON adaptations(user_id);

      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        user_text TEXT NOT NULL,
        assistant_text TEXT NOT NULL,
        score REAL NOT NULL,
        signal TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
    `);

    // Migrate: add user_id column if missing (existing installs).
    try { this.db.exec(`ALTER TABLE memories ADD COLUMN user_id TEXT DEFAULT 'global'`); } catch { /* exists */ }
    try { this.db.exec(`ALTER TABLE turns ADD COLUMN user_id TEXT DEFAULT 'global'`); } catch { /* exists */ }
  }

  // ─────────────────── memories ───────────────────

  remember(
    kind: Memory["kind"],
    content: string,
    opts: { tags?: string[]; salience?: number; emotion?: number; userId?: string } = {},
  ): number {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO memories (kind, content, tags, salience, emotion, user_id, created_at, last_accessed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      kind,
      content,
      (opts.tags ?? []).join(","),
      opts.salience ?? 0.5,
      opts.emotion ?? 0,
      opts.userId ?? "global",
      now,
      now,
    );
    return Number(res.lastInsertRowid);
  }

  /**
   * Retrieve memories — user-specific first, then global fallback.
   */
  retrieve(query: string, topK = 8, userId?: string): Memory[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 3)
      .slice(0, 6);

    if (terms.length === 0) {
      const userFilter = userId ? `WHERE user_id IN (?, 'global')` : ``;
      const params = userId ? [userId, topK] : [topK];
      return this.db
        .prepare(`SELECT * FROM memories ${userFilter} ORDER BY salience DESC, created_at DESC LIMIT ?`)
        .all(...params) as Memory[];
    }

    const likeClauses = terms.map(() => "LOWER(content) LIKE ?").join(" OR ");
    const params = terms.map((t) => `%${t}%`);
    const userFilter = userId ? ` AND user_id IN ('${userId}', 'global')` : ``;
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE (${likeClauses})${userFilter}
         ORDER BY salience DESC, created_at DESC LIMIT ?`,
      )
      .all(...params, topK) as Memory[];

    const touch = this.db.prepare(`UPDATE memories SET last_accessed = ? WHERE id = ?`);
    const now = Date.now();
    for (const r of rows) touch.run(now, r.id);

    return rows;
  }

  // ─────────────────── turns ───────────────────

  recordTurn(sessionId: string, role: "user" | "assistant", content: string, affect: object = {}, userId?: string) {
    this.db
      .prepare(
        `INSERT INTO turns (session_id, user_id, role, content, affect, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, userId ?? "global", role, content, JSON.stringify(affect), Date.now());
  }

  recentTurns(sessionId: string, limit = 20) {
    return this.db
      .prepare(
        `SELECT role, content, affect, created_at FROM turns
         WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sessionId, limit)
      .reverse();
  }

  /** Get recent turns across ALL sessions for a user — cross-session memory. */
  userHistory(userId: string, limit = 30) {
    return this.db
      .prepare(
        `SELECT role, content, created_at FROM turns
         WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, limit)
      .reverse();
  }

  // ─────────────────── profile ───────────────────

  setProfile(key: string, value: string) {
    this.db
      .prepare(
        `INSERT INTO profile (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, Date.now());
  }

  getProfile(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM profile WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  // ─────────────────── adaptations (JARVIS self-written notes) ───────────────────

  /**
   * JARVIS writes a behavioral note about a user.
   * This is the "self-modifying" part — JARVIS adjusts its own behavior
   * by writing notes that get injected into future system prompts.
   */
  addAdaptation(
    userId: string,
    category: Adaptation["category"],
    content: string,
    confidence = 0.7,
  ): number {
    // Avoid duplicates — if a very similar adaptation exists, update it.
    const existing = this.db.prepare(
      `SELECT id FROM adaptations WHERE user_id = ? AND category = ? AND content = ?`
    ).get(userId, category, content) as { id: number } | undefined;

    if (existing) {
      this.db.prepare(`UPDATE adaptations SET confidence = ?, created_at = ? WHERE id = ?`)
        .run(Math.min(confidence + 0.1, 1.0), Date.now(), existing.id);
      return existing.id;
    }

    const res = this.db.prepare(
      `INSERT INTO adaptations (user_id, category, content, confidence, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, category, content, confidence, Date.now());
    return Number(res.lastInsertRowid);
  }

  /** Get all adaptations for a user, sorted by confidence. */
  getAdaptations(userId: string, limit = 20): Adaptation[] {
    return this.db.prepare(
      `SELECT * FROM adaptations WHERE user_id = ? ORDER BY confidence DESC, created_at DESC LIMIT ?`
    ).all(userId, limit) as Adaptation[];
  }

  /** Remove low-confidence adaptations (self-cleanup). */
  pruneAdaptations(userId: string, minConfidence = 0.3) {
    this.db.prepare(
      `DELETE FROM adaptations WHERE user_id = ? AND confidence < ?`
    ).run(userId, minConfidence);
  }

  // ─────────────────── interaction scoring ───────────────────

  recordScore(
    userId: string,
    sessionId: string,
    userText: string,
    assistantText: string,
    score: number,
    signal: string,
  ) {
    this.db.prepare(
      `INSERT INTO scores (user_id, session_id, user_text, assistant_text, score, signal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, sessionId, userText, assistantText, score, signal, Date.now());
  }

  /** Average quality score for a user's recent interactions. */
  avgScore(userId: string, recentN = 50): number {
    const row = this.db.prepare(
      `SELECT AVG(score) as avg FROM (
         SELECT score FROM scores WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       )`
    ).get(userId, recentN) as { avg: number | null } | undefined;
    return row?.avg ?? 0.5;
  }

  // ─────────────────── export ───────────────────

  exportAll() {
    return {
      memories: this.db.prepare(`SELECT * FROM memories`).all(),
      profile: this.db.prepare(`SELECT * FROM profile`).all(),
      adaptations: this.db.prepare(`SELECT * FROM adaptations`).all(),
      scores: this.db.prepare(`SELECT * FROM scores ORDER BY created_at DESC LIMIT 100`).all(),
    };
  }
}

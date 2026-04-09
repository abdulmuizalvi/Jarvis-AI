/**
 * Memory Broker — Phase 1 SQLite implementation.
 *
 * Phase 2 will add:
 *   - Pinecone for vector retrieval
 *   - Neo4j for episodic/graph memory
 *   - Cohere Rerank for final ranking
 *   - Nightly consolidation worker
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Memory {
  id: number;
  kind: "working" | "episodic" | "semantic" | "profile" | "emotional";
  content: string;
  tags: string;          // comma-separated
  salience: number;      // 0..1
  emotion: number;       // valence, −1..1
  created_at: number;
  last_accessed: number;
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
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

      CREATE TABLE IF NOT EXISTS turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        affect TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, created_at);

      CREATE TABLE IF NOT EXISTS profile (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  remember(
    kind: Memory["kind"],
    content: string,
    opts: { tags?: string[]; salience?: number; emotion?: number } = {},
  ): number {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO memories (kind, content, tags, salience, emotion, created_at, last_accessed)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      kind,
      content,
      (opts.tags ?? []).join(","),
      opts.salience ?? 0.5,
      opts.emotion ?? 0,
      now,
      now,
    );
    return Number(res.lastInsertRowid);
  }

  /**
   * Phase 1 retrieval: naive full-text LIKE + recency + salience.
   * Phase 2 will replace with vector search + rerank.
   */
  retrieve(query: string, topK = 8): Memory[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 3)
      .slice(0, 6);

    if (terms.length === 0) {
      return this.db
        .prepare(`SELECT * FROM memories ORDER BY salience DESC, created_at DESC LIMIT ?`)
        .all(topK) as Memory[];
    }

    const likeClauses = terms.map(() => "LOWER(content) LIKE ?").join(" OR ");
    const params = terms.map((t) => `%${t}%`);
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE ${likeClauses}
         ORDER BY salience DESC, created_at DESC LIMIT ?`,
      )
      .all(...params, topK) as Memory[];

    const touch = this.db.prepare(`UPDATE memories SET last_accessed = ? WHERE id = ?`);
    const now = Date.now();
    for (const r of rows) touch.run(now, r.id);

    return rows;
  }

  recordTurn(sessionId: string, role: "user" | "assistant", content: string, affect: object = {}) {
    this.db
      .prepare(
        `INSERT INTO turns (session_id, role, content, affect, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, role, content, JSON.stringify(affect), Date.now());
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

  exportAll() {
    return {
      memories: this.db.prepare(`SELECT * FROM memories`).all(),
      profile: this.db.prepare(`SELECT * FROM profile`).all(),
    };
  }
}

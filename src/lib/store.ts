import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface SessionRow {
  id: number;
  session_id: string;
  project_root: string;
  session_dir: string;
  branch: string;
  mode: string;
  in_place: number;
  created_at: string;
  destroyed_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  project_root  TEXT NOT NULL,
  session_dir   TEXT NOT NULL,
  branch        TEXT NOT NULL DEFAULT '',
  mode          TEXT NOT NULL DEFAULT 'docker',
  in_place      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  destroyed_at  TEXT,
  UNIQUE(session_id, project_root)
);
`;

function defaultDbPath(): string {
  return join(homedir(), '.dev-prism', 'sessions.db');
}

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? defaultDbPath();

    // Ensure parent directory exists (unless in-memory)
    if (path !== ':memory:') {
      const dir = dirname(path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 3000');
    this.db.exec(SCHEMA);
  }

  insert(row: {
    sessionId: string;
    projectRoot: string;
    sessionDir: string;
    branch?: string;
    mode?: string;
    inPlace?: boolean;
  }): SessionRow {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (session_id, project_root, session_dir, branch, mode, in_place)
      VALUES (@session_id, @project_root, @session_dir, @branch, @mode, @in_place)
    `);

    const info = stmt.run({
      session_id: row.sessionId,
      project_root: row.projectRoot,
      session_dir: row.sessionDir,
      branch: row.branch ?? '',
      mode: row.mode ?? 'docker',
      in_place: row.inPlace ? 1 : 0,
    });

    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid) as SessionRow;
  }

  listByProject(projectRoot: string): SessionRow[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE project_root = ? AND destroyed_at IS NULL ORDER BY session_id')
      .all(projectRoot) as SessionRow[];
  }

  listAll(): SessionRow[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE destroyed_at IS NULL ORDER BY project_root, session_id')
      .all() as SessionRow[];
  }

  findSession(projectRoot: string, sessionId: string): SessionRow | undefined {
    return this.db
      .prepare('SELECT * FROM sessions WHERE project_root = ? AND session_id = ? AND destroyed_at IS NULL')
      .get(projectRoot, sessionId) as SessionRow | undefined;
  }

  findByDir(sessionDir: string): SessionRow | undefined {
    return this.db
      .prepare('SELECT * FROM sessions WHERE session_dir = ? AND destroyed_at IS NULL')
      .get(sessionDir) as SessionRow | undefined;
  }

  getUsedSessionIds(projectRoot: string): Set<string> {
    const rows = this.db
      .prepare('SELECT session_id FROM sessions WHERE project_root = ? AND destroyed_at IS NULL')
      .all(projectRoot) as Array<{ session_id: string }>;
    return new Set(rows.map((r) => r.session_id));
  }

  markDestroyed(projectRoot: string, sessionId: string): boolean {
    const info = this.db
      .prepare("UPDATE sessions SET destroyed_at = datetime('now') WHERE project_root = ? AND session_id = ? AND destroyed_at IS NULL")
      .run(projectRoot, sessionId);
    return info.changes > 0;
  }

  remove(projectRoot: string, sessionId: string): boolean {
    const info = this.db
      .prepare('DELETE FROM sessions WHERE project_root = ? AND session_id = ?')
      .run(projectRoot, sessionId);
    return info.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

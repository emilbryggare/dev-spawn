import Database from 'better-sqlite3';
import getPort from 'get-port';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface DbSession {
  id: string;
  branch: string | null;
  created_at: string;
}

export interface PortAllocation {
  session_id: string;
  service: string;
  port: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  branch     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS port_allocations (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  service    TEXT NOT NULL,
  port       INTEGER NOT NULL UNIQUE,
  PRIMARY KEY (session_id, service)
);

CREATE TABLE IF NOT EXISTS reservations (
  port       INTEGER PRIMARY KEY,
  reason     TEXT,
  created_at TEXT NOT NULL
);
`;

export function openDatabase(): Database.Database {
  const dbDir = join(homedir(), '.dev-prism');
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const db = new Database(join(dbDir, 'sessions.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir);
  while (true) {
    if (
      existsSync(join(dir, 'prism.config.mjs')) ||
      existsSync(join(dir, 'prism.config.js'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        'Could not find prism.config.mjs in any parent directory'
      );
    }
    dir = parent;
  }
}

export function createDbSession(
  db: Database.Database,
  session: DbSession
): void {
  db.prepare(
    'INSERT INTO sessions (id, branch, created_at) VALUES (?, ?, ?)'
  ).run(session.id, session.branch, session.created_at);
}

export function deleteDbSession(
  db: Database.Database,
  sessionId: string
): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function getDbSession(
  db: Database.Database,
  sessionId: string
): DbSession | undefined {
  return db
    .prepare('SELECT id, branch, created_at FROM sessions WHERE id = ?')
    .get(sessionId) as DbSession | undefined;
}

export function listDbSessions(db: Database.Database): DbSession[] {
  return db
    .prepare('SELECT id, branch, created_at FROM sessions ORDER BY created_at')
    .all() as DbSession[];
}

export function getPortAllocations(
  db: Database.Database,
  sessionId: string
): PortAllocation[] {
  return db
    .prepare(
      'SELECT session_id, service, port FROM port_allocations WHERE session_id = ?'
    )
    .all(sessionId) as PortAllocation[];
}

export function getAllocatedPorts(db: Database.Database): number[] {
  return (
    db.prepare('SELECT port FROM port_allocations').all() as { port: number }[]
  ).map((r) => r.port);
}

export function getReservedPorts(db: Database.Database): number[] {
  return (
    db.prepare('SELECT port FROM reservations').all() as { port: number }[]
  ).map((r) => r.port);
}

export function reservePort(
  db: Database.Database,
  port: number,
  reason?: string
): void {
  db.prepare(
    'INSERT INTO reservations (port, reason, created_at) VALUES (?, ?, ?)'
  ).run(port, reason ?? null, new Date().toISOString());
}

export function unreservePort(db: Database.Database, port: number): void {
  db.prepare('DELETE FROM reservations WHERE port = ?').run(port);
}

export async function allocatePorts(
  db: Database.Database,
  sessionId: string,
  services: string[]
): Promise<PortAllocation[]> {
  if (services.length === 0) return [];

  const excludePorts = new Set([
    ...getAllocatedPorts(db),
    ...getReservedPorts(db),
  ]);

  const allocations: PortAllocation[] = [];

  for (const name of services) {
    const port = await getPort({ exclude: [...excludePorts] });
    excludePorts.add(port);
    allocations.push({
      session_id: sessionId,
      service: name,
      port,
    });
  }

  const insert = db.prepare(
    'INSERT INTO port_allocations (session_id, service, port) VALUES (?, ?, ?)'
  );

  try {
    const insertAll = db.transaction(() => {
      for (const alloc of allocations) {
        insert.run(alloc.session_id, alloc.service, alloc.port);
      }
    });
    insertAll();
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      // Retry once on race condition
      const retryExclude = new Set([
        ...getAllocatedPorts(db),
        ...getReservedPorts(db),
      ]);
      const retryAllocations: PortAllocation[] = [];
      for (const name of services) {
        const port = await getPort({ exclude: [...retryExclude] });
        retryExclude.add(port);
        retryAllocations.push({
          session_id: sessionId,
          service: name,
          port,
        });
      }
      const insertAllRetry = db.transaction(() => {
        for (const alloc of retryAllocations) {
          insert.run(alloc.session_id, alloc.service, alloc.port);
        }
      });
      insertAllRetry();
      return retryAllocations;
    }
    throw err;
  }

  return allocations;
}

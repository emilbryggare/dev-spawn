import { execa } from 'execa';
import { loadConfig } from '../lib/config.js';
import { buildSessionEnv } from '../lib/env.js';
import {
  findProjectRoot,
  openDatabase,
  getDbSession,
  getPortAllocations,
} from '../lib/db.js';

export async function withEnv(
  command: string[],
  appName?: string
): Promise<void> {
  if (command.length === 0) {
    console.error('Usage: dev-prism with-env [app] -- <command>');
    process.exit(1);
  }

  const cwd = process.cwd();

  // Build session env — if anything fails, pass through
  let sessionEnv: Record<string, string> = {};

  try {
    const projectRoot = findProjectRoot(cwd);
    const db = openDatabase();

    try {
      const session = getDbSession(db, cwd);

      if (session) {
        const ports = getPortAllocations(db, session.id);
        const config = await loadConfig(projectRoot);
        sessionEnv = buildSessionEnv(config, cwd, ports, appName);
      }
    } finally {
      db.close();
    }
  } catch {
    // No project root or no database — pass through
  }

  const [cmd, ...args] = command;
  const merged = {
    ...(process.env as Record<string, string>),
    ...sessionEnv,
  };

  try {
    const result = await execa(cmd, args, {
      stdio: 'inherit',
      env: merged,
      reject: false,
    });

    if (result.exitCode !== undefined && result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  } catch (error: any) {
    // Command not found or other execution error
    console.error(error.message);
    process.exit(1);
  }
}

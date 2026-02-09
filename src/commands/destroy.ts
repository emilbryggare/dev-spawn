import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { removeWorktree } from '../lib/worktree.js';
import { loadConfig, getSessionsDir } from '../lib/config.js';
import {
  findProjectRoot,
  openDatabase,
  getDbSession,
  listDbSessions,
  deleteDbSession,
} from '../lib/db.js';

export interface DestroyOptions {
  all?: boolean;
}

export async function destroySession(
  workingDir: string,
  options: DestroyOptions
): Promise<void> {
  let projectRoot: string;
  try {
    projectRoot = findProjectRoot(workingDir);
  } catch {
    console.error(chalk.red('Error: Could not find prism.config.mjs'));
    process.exit(1);
  }

  const db = openDatabase();

  try {
    if (options.all) {
      console.log(chalk.blue('Destroying all sessions...'));

      const sessions = listDbSessions(db);
      if (sessions.length === 0) {
        console.log(chalk.gray('No sessions found.'));
        return;
      }

      const config = await loadConfig(projectRoot);
      const sessionsDir = getSessionsDir(config, projectRoot);

      for (const session of sessions) {
        await destroySingleSession(
          db,
          projectRoot,
          sessionsDir,
          session.id,
          session.branch
        );
      }

      console.log(chalk.green(`\nDestroyed ${sessions.length} session(s).`));
      return;
    }

    const session = getDbSession(db, workingDir);
    if (!session) {
      console.error(
        chalk.red(`Error: No session found for ${workingDir}`)
      );
      process.exit(1);
    }

    const config = await loadConfig(projectRoot);
    const sessionsDir = getSessionsDir(config, projectRoot);

    await destroySingleSession(
      db,
      projectRoot,
      sessionsDir,
      session.id,
      session.branch
    );

    console.log(chalk.green('\nSession destroyed.'));
  } finally {
    db.close();
  }
}

async function destroySingleSession(
  db: ReturnType<typeof openDatabase>,
  projectRoot: string,
  sessionsDir: string,
  sessionId: string,
  branch: string | null
): Promise<void> {
  console.log(chalk.blue(`\nDestroying session in ${sessionId}...`));

  // Delete from database (cascades to port_allocations)
  deleteDbSession(db, sessionId);
  console.log(chalk.gray('  Removed from database.'));

  // Remove worktree if it's in the sessions directory
  if (branch && sessionId.startsWith(sessionsDir) && existsSync(sessionId)) {
    console.log(chalk.gray('  Removing git worktree...'));
    try {
      await removeWorktree(projectRoot, sessionId, branch);
    } catch (error) {
      console.warn(
        chalk.yellow(`  Warning: Could not remove worktree: ${error}`)
      );
    }
  }

  console.log(chalk.green('  Session destroyed.'));
}

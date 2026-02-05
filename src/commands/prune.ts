import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { removeWorktree } from '../lib/worktree.js';
import * as docker from '../lib/docker.js';
import { SessionStore } from '../lib/store.js';

export interface PruneOptions {
  yes?: boolean;
}

export async function pruneSessions(projectRoot: string, options: PruneOptions): Promise<void> {
  const config = await loadConfig(projectRoot);

  const store = new SessionStore();
  try {

  const sessions = store.listByProject(projectRoot);

  if (sessions.length === 0) {
    console.log(chalk.gray('No sessions found.'));
    return;
  }

  // Find stopped sessions
  const stoppedSessions: Array<{ sessionId: string; path: string; branch: string; inPlace: boolean }> = [];
  for (const session of sessions) {
    const envFile = resolve(session.session_dir, '.env.session');
    let running = false;
    if (existsSync(envFile)) {
      running = await docker.isRunning({ cwd: session.session_dir });
    }
    if (!running) {
      stoppedSessions.push({
        sessionId: session.session_id,
        path: session.session_dir,
        branch: session.branch,
        inPlace: session.in_place === 1,
      });
    }
  }

  if (stoppedSessions.length === 0) {
    console.log(chalk.gray('No stopped sessions to prune.'));
    return;
  }

  console.log(chalk.yellow(`\nFound ${stoppedSessions.length} stopped session(s) to prune:`));
  for (const session of stoppedSessions) {
    console.log(chalk.gray(`  - Session ${session.sessionId} (${session.branch})`));
  }
  console.log('');

  // Confirm unless --yes flag provided
  if (!options.yes) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(chalk.red('Are you sure you want to delete these sessions? This cannot be undone. [y/N] '), resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }

  console.log(chalk.blue('\nPruning stopped sessions...\n'));

  for (const session of stoppedSessions) {
    console.log(chalk.gray(`  Removing session ${session.sessionId}...`));
    try {
      // Clean up any docker resources
      const envFile = resolve(session.path, '.env.session');
      if (existsSync(envFile)) {
        try {
          await docker.down({ cwd: session.path });
        } catch {
          // Ignore errors - containers might already be removed
        }
      }
      // Remove worktree and branch (skip for in-place sessions)
      if (!session.inPlace) {
        await removeWorktree(projectRoot, session.path, session.branch);
      }
      store.markDestroyed(projectRoot, session.sessionId);
      console.log(chalk.green(`  Session ${session.sessionId} removed.`));
    } catch {
      console.log(chalk.yellow(`  Warning: Could not fully remove session ${session.sessionId}`));
    }
  }

  console.log(chalk.green(`\nPruned ${stoppedSessions.length} session(s).`));

  } finally {
    store.close();
  }
}

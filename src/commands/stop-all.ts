import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { execa } from 'execa';
import { loadConfig } from '../lib/config.js';
import { SessionStore } from '../lib/store.js';
import * as docker from '../lib/docker.js';

export async function stopAllSessions(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot);

  const store = new SessionStore();
  let sessions;
  try {
    sessions = store.listByProject(projectRoot);
  } finally {
    store.close();
  }

  if (sessions.length === 0) {
    console.log(chalk.gray('No sessions found.'));
    return;
  }

  // Find running sessions
  const runningSessions: Array<{ sessionId: string; path: string }> = [];
  for (const session of sessions) {
    const envFile = resolve(session.session_dir, '.env.session');
    if (existsSync(envFile)) {
      const running = await docker.isRunning({ cwd: session.session_dir });
      if (running) {
        runningSessions.push({ sessionId: session.session_id, path: session.session_dir });
      }
    }
  }

  if (runningSessions.length === 0) {
    console.log(chalk.gray('No running sessions found.'));
    return;
  }

  console.log(chalk.blue(`Stopping ${runningSessions.length} running session(s)...\n`));

  // Get all app profiles and service names to ensure we stop everything
  const allApps = config.apps ?? [];
  const profileFlags = allApps.flatMap((p: string) => ['--profile', p]);
  // Explicitly list all services to stop (infrastructure + apps)
  const allServices = ['postgres', 'mailpit', ...allApps];

  for (const session of runningSessions) {
    console.log(chalk.gray(`  Stopping session ${session.sessionId}...`));
    try {
      await execa(
        'docker',
        ['compose', '-f', 'docker-compose.session.yml', '--env-file', '.env.session', ...profileFlags, 'stop', ...allServices],
        { cwd: session.path, stdio: 'pipe' }
      );
      console.log(chalk.green(`  Session ${session.sessionId} stopped.`));
    } catch {
      console.log(chalk.yellow(`  Warning: Could not stop session ${session.sessionId}`));
    }
  }

  console.log(chalk.green(`\nStopped ${runningSessions.length} session(s).`));
}

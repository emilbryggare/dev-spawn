import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { calculatePorts } from '../lib/ports.js';
import { SessionStore } from '../lib/store.js';
import * as docker from '../lib/docker.js';

interface SessionStatus {
  sessionId: string;
  path: string;
  branch: string;
  running: boolean;
  ports: Record<string, number>;
}

export async function listSessions(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot);

  const store = new SessionStore();
  let sessions;
  try {
    sessions = store.listByProject(projectRoot);
  } finally {
    store.close();
  }

  if (sessions.length === 0) {
    console.log(chalk.gray('No active sessions found.'));
    console.log(chalk.gray('\nTo create a session:'));
    console.log(chalk.cyan('  dev-prism create'));
    return;
  }

  console.log(chalk.blue('Active Sessions:'));
  console.log(chalk.gray('================\n'));

  for (const session of sessions) {
    const status = await getSessionStatus(session.session_id, session.session_dir, session.branch, config);
    printSessionStatus(status);
  }
}

async function getSessionStatus(
  sessionId: string,
  path: string,
  branch: string,
  config: Awaited<ReturnType<typeof loadConfig>>
): Promise<SessionStatus> {
  const ports = calculatePorts(config, sessionId);

  // Check if docker containers are running
  let running = false;
  const envFile = resolve(path, '.env.session');
  if (existsSync(envFile)) {
    running = await docker.isRunning({ cwd: path });
  }

  return {
    sessionId,
    path,
    branch,
    running,
    ports,
  };
}

function printSessionStatus(status: SessionStatus): void {
  const statusIcon = status.running ? chalk.green('●') : chalk.red('○');
  const statusText = status.running ? chalk.green('running') : chalk.gray('stopped');

  console.log(`${statusIcon} Session ${chalk.bold(status.sessionId)} ${statusText}`);
  console.log(chalk.gray(`  Path: ${status.path}`));
  console.log(chalk.gray(`  Branch: ${status.branch}`));

  // Print ports grouped by type
  console.log(chalk.gray('  Ports:'));
  for (const [name, port] of Object.entries(status.ports)) {
    const isApp = name.includes('APP') || name.includes('WEB') || name.includes('WIDGET');
    if (isApp) {
      console.log(chalk.gray(`    ${name}: http://localhost:${port}`));
    } else {
      console.log(chalk.gray(`    ${name}: ${port}`));
    }
  }

  console.log('');
}

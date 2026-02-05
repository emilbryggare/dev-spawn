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

export async function listSessions(projectRoot: string, options?: { all?: boolean }): Promise<void> {
  const showAll = options?.all ?? false;
  const config = await loadConfig(projectRoot);

  const store = new SessionStore();
  let sessions;
  try {
    const projectSessions = store.listByProject(projectRoot);
    // Show all sessions if --all flag is set, or if no sessions found for current project
    if (showAll || projectSessions.length === 0) {
      sessions = store.listAll();
    } else {
      sessions = projectSessions;
    }
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
    const sessionConfig = await loadConfig(session.project_root).catch(() => config);
    const status = await getSessionStatus(session.session_id, session.session_dir, session.branch, sessionConfig);
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

  // Print all ports
  console.log(chalk.gray('  Ports:'));
  for (const [name, port] of Object.entries(status.ports)) {
    console.log(chalk.cyan(`    ${name}: http://localhost:${port}`));
  }

  console.log('');
}

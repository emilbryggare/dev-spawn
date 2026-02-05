import chalk from 'chalk';
import { execa } from 'execa';
import { loadConfig } from '../lib/config.js';
import { SessionStore } from '../lib/store.js';

export interface LogsOptions {
  mode?: string;
  without?: string[];
  tail?: string;
}

export async function streamLogs(
  projectRoot: string,
  sessionId: string,
  options: LogsOptions
): Promise<void> {
  const config = await loadConfig(projectRoot);

  const store = new SessionStore();
  let sessionDir: string;
  try {
    const session = store.findSession(projectRoot, sessionId);
    if (!session) {
      console.error(chalk.red(`Error: Session ${sessionId} not found.`));
      process.exit(1);
    }
    sessionDir = session.session_dir;
  } finally {
    store.close();
  }

  let profileFlags: string[] = [];
  if (options.mode === 'docker') {
    const allApps = config.apps ?? [];
    const excludeApps = options.without ?? [];
    const profiles = allApps.filter((app) => !excludeApps.includes(app));
    profileFlags = profiles.flatMap((p) => ['--profile', p]);
  }

  const args = [
    'compose',
    '-f', 'docker-compose.session.yml',
    '--env-file', '.env.session',
    ...profileFlags,
    'logs',
    '-f',
    '--tail', options.tail ?? '50',
  ];

  await execa('docker', args, { cwd: sessionDir, stdio: 'inherit' });
}

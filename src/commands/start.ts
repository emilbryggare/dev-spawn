import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { SessionStore } from '../lib/store.js';
import * as docker from '../lib/docker.js';

export interface StartOptions {
  mode?: string;
  without?: string[];
}

export async function startSession(
  projectRoot: string,
  sessionId: string,
  options: StartOptions
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

  let profiles: string[] | undefined;
  if (options.mode === 'docker') {
    const allApps = config.apps ?? [];
    const excludeApps = options.without ?? [];
    profiles = allApps.filter((app) => !excludeApps.includes(app));
  }

  await docker.up({ cwd: sessionDir, profiles });
}

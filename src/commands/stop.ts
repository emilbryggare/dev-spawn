import chalk from 'chalk';
import { execa } from 'execa';
import { SessionStore } from '../lib/store.js';

export async function stopSession(
  projectRoot: string,
  sessionId: string,
): Promise<void> {
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

  // Use stop instead of down to preserve volumes
  await execa(
    'docker',
    ['compose', '-f', 'docker-compose.session.yml', '--env-file', '.env.session', 'stop'],
    { cwd: sessionDir, stdio: 'inherit' }
  );
}

import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { buildSessionEnv } from '../lib/env.js';
import {
  findProjectRoot,
  openDatabase,
  getDbSession,
  getPortAllocations,
} from '../lib/db.js';

export async function showInfo(cwd: string): Promise<void> {
  let projectRoot: string;
  try {
    projectRoot = findProjectRoot(cwd);
  } catch {
    console.log(chalk.yellow('No session found (no prism.config.mjs in parent directories).'));
    process.exit(1);
  }

  const db = openDatabase();

  try {
    const session = getDbSession(db, cwd);

    if (!session) {
      console.log(chalk.yellow('No session found for this directory.'));
      console.log(
        chalk.gray('Run `dev-prism create --in-place` to create a session here.')
      );
      process.exit(1);
    }

    const ports = getPortAllocations(db, session.id);
    const config = await loadConfig(projectRoot);
    const env = buildSessionEnv(config, cwd, ports);

    console.log(chalk.blue('\nSession'));
    console.log(chalk.gray(`Directory: ${session.id}`));
    if (session.branch) {
      console.log(chalk.gray(`Branch: ${session.branch}`));
    }
    console.log(chalk.gray(`Created: ${session.created_at}`));

    if (ports.length > 0) {
      console.log(chalk.gray('\nPorts:'));
      for (const port of ports) {
        console.log(
          chalk.cyan(
            `  ${port.service}: http://localhost:${port.port}`
          )
        );
      }
    }

    if (Object.keys(env).length > 0) {
      console.log(chalk.gray('\nEnvironment:'));
      for (const [key, value] of Object.entries(env)) {
        console.log(chalk.gray(`  ${key}=${value}`));
      }
    }

    console.log('');
  } finally {
    db.close();
  }
}

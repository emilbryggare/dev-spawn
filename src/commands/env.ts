import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { buildSessionEnv, formatEnvFile } from '../lib/env.js';
import {
  findProjectRoot,
  openDatabase,
  getDbSession,
  getPortAllocations,
} from '../lib/db.js';

export interface EnvOptions {
  write?: string;
  app?: string;
}

export async function showEnv(options: EnvOptions): Promise<void> {
  const cwd = process.cwd();

  let projectRoot: string;
  try {
    projectRoot = findProjectRoot(cwd);
  } catch {
    console.error(chalk.red('Error: Could not find prism.config.mjs'));
    process.exit(1);
  }

  const db = openDatabase();

  try {
    const session = getDbSession(db, cwd);

    if (!session) {
      console.error(chalk.red('Error: No session found for this directory.'));
      console.error(
        chalk.gray('Run `dev-prism create --in-place` to create a session here.')
      );
      process.exit(1);
    }

    const ports = getPortAllocations(db, session.id);
    const config = await loadConfig(projectRoot);
    const env = buildSessionEnv(config, cwd, ports, options.app);

    if (options.write) {
      const filePath = resolve(cwd, options.write);
      writeFileSync(filePath, formatEnvFile(env), 'utf-8');
      console.error(chalk.green(`Written: ${filePath}`));
    } else {
      // Print to stdout for eval/piping
      process.stdout.write(formatEnvFile(env));
    }
  } finally {
    db.close();
  }
}

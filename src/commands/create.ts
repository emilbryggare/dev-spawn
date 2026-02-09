import { existsSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import chalk from 'chalk';
import { execa } from 'execa';
import { loadConfig, getSessionsDir } from '../lib/config.js';
import { buildSessionEnv } from '../lib/env.js';
import {
  openDatabase,
  createDbSession,
  getDbSession,
  allocatePorts,
} from '../lib/db.js';
import {
  createWorktree,
  generateDefaultBranchName,
  removeWorktree,
} from '../lib/worktree.js';

export interface CreateOptions {
  branch?: string;
  inPlace?: boolean;
}

export async function createSession(
  projectRoot: string,
  options: CreateOptions
): Promise<void> {
  const config = await loadConfig(projectRoot);
  const sessionsDir = getSessionsDir(config, projectRoot);

  const inPlace = options.inPlace ?? false;

  let workingDir: string;
  let branchName = '';

  if (inPlace) {
    workingDir = projectRoot;
    console.log(chalk.blue('Creating session in current directory...'));
  } else {
    branchName = options.branch || generateDefaultBranchName();
    workingDir = resolve(sessionsDir, branchName);

    console.log(chalk.blue('Creating session...'));
    console.log(chalk.gray(`Branch: ${branchName}`));
    console.log(chalk.gray(`Directory: ${workingDir}`));
  }

  const db = openDatabase();

  try {
    // Check if session already exists
    if (getDbSession(db, workingDir)) {
      console.error(chalk.red('Error: Session already exists for this directory.'));
      console.error(chalk.gray('Destroy it first with: dev-prism destroy'));
      process.exit(1);
    }

    if (!inPlace) {
      if (!existsSync(sessionsDir)) {
        mkdirSync(sessionsDir, { recursive: true });
      }

      console.log(chalk.blue('\nCreating git worktree...'));
      await createWorktree(projectRoot, workingDir, branchName);
      console.log(chalk.green(`  Created: ${workingDir}`));
    }

    // Insert session record
    createDbSession(db, {
      id: workingDir,
      branch: branchName || null,
      created_at: new Date().toISOString(),
    });

    // Allocate ports
    console.log(chalk.blue('\nAllocating ports...'));
    const allocations = await allocatePorts(db, workingDir, config.ports);

    if (allocations.length > 0) {
      console.log(chalk.gray('Allocated ports:'));
      for (const alloc of allocations) {
        console.log(
          chalk.cyan(`  ${alloc.service}: ${alloc.port}`)
        );
      }
    }

    // Run setup commands with session env injected
    if (config.setup.length > 0) {
      console.log(chalk.blue('\nRunning setup commands...'));

      const sessionEnv = buildSessionEnv(config, workingDir, allocations);
      const setupEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ...sessionEnv,
      };

      for (const cmd of config.setup) {
        console.log(chalk.gray(`  Running: ${cmd}`));
        const [command, ...args] = cmd.split(' ');
        try {
          await execa(command, args, {
            cwd: workingDir,
            stdio: 'inherit',
            env: setupEnv,
          });
        } catch {
          console.warn(chalk.yellow(`  Warning: Command failed: ${cmd}`));
        }
      }
    }

    // Print summary
    console.log(chalk.green('\nSession ready!'));
    console.log(chalk.gray(`Directory: ${workingDir}`));

    if (allocations.length > 0) {
      console.log(chalk.gray('\nPorts:'));
      for (const alloc of allocations) {
        console.log(
          chalk.cyan(`  ${alloc.service}: http://localhost:${alloc.port}`)
        );
      }
    }

    console.log(chalk.gray('\nUsage:'));
    console.log(
      chalk.gray('  dev-prism with-env -- docker compose up -d')
    );
    console.log(
      chalk.gray('  dev-prism with-env -- pnpm dev')
    );
    console.log(
      chalk.gray('  dev-prism env                # show env vars')
    );
  } catch (error) {
    console.error(chalk.red('Session creation failed. Cleaning up...'));
    try {
      const { deleteDbSession } = await import('../lib/db.js');
      deleteDbSession(db, workingDir);
    } catch {
      /* ignore */
    }
    if (!inPlace && branchName) {
      try {
        await removeWorktree(projectRoot, workingDir, branchName);
      } catch {
        /* ignore */
      }
    }
    throw error;
  } finally {
    db.close();
  }
}

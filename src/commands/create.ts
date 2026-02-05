import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import chalk from 'chalk';
import { execa } from 'execa';
import { loadConfig, getSessionDir, getSessionsDir } from '../lib/config.js';
import { calculatePorts, formatPortsTable } from '../lib/ports.js';
import { writeEnvFile, writeAppEnvFiles } from '../lib/env.js';
import { createWorktree, findNextSessionId, generateDefaultBranchName, removeWorktree } from '../lib/worktree.js';
import * as docker from '../lib/docker.js';
import { SessionStore } from '../lib/store.js';

function updateEnvDatabaseUrl(envPath: string, newDbUrl: string): void {
  if (!existsSync(envPath)) return;

  let content = readFileSync(envPath, 'utf-8');
  // Replace DATABASE_URL line if it exists
  if (content.includes('DATABASE_URL=')) {
    content = content.replace(/^DATABASE_URL=.*/m, `DATABASE_URL=${newDbUrl}`);
  } else {
    // Add it if it doesn't exist
    content += `\nDATABASE_URL=${newDbUrl}\n`;
  }
  writeFileSync(envPath, content);
}

export interface CreateOptions {
  mode?: 'docker' | 'native';
  branch?: string;
  detach?: boolean; // default true, set false to stream logs after starting
  without?: string[]; // apps to exclude in docker mode
  inPlace?: boolean; // run in current directory instead of creating a worktree
}

export async function createSession(
  projectRoot: string,
  sessionId: string | undefined,
  options: CreateOptions
): Promise<void> {
  // Load config first (needed for auto-assign)
  const config = await loadConfig(projectRoot);
  const sessionsDir = getSessionsDir(config, projectRoot);

  const store = new SessionStore();
  try {

  // Auto-assign session ID if not provided
  if (!sessionId) {
    sessionId = findNextSessionId(store.getUsedSessionIds(projectRoot));
    console.log(chalk.gray(`Auto-assigned session ID: ${sessionId}`));
  }

  // Validate session ID
  if (!/^\d{3}$/.test(sessionId)) {
    console.error(chalk.red('Error: Session ID must be exactly 3 digits (001-999)'));
    process.exit(1);
  }

  const inPlace = options.inPlace ?? false;

  // Determine branch name (not used for in-place mode)
  const branchName = options.branch || generateDefaultBranchName(sessionId);

  const mode = options.mode || 'docker';
  console.log(chalk.blue(`Creating session ${sessionId} (${mode} mode${inPlace ? ', in-place' : ''})...`));
  if (!inPlace) {
    console.log(chalk.gray(`Branch: ${branchName}`));
  }

  // Calculate ports
  const ports = calculatePorts(config, sessionId);
  console.log(chalk.gray('\nPorts:'));
  console.log(chalk.gray(formatPortsTable(ports)));

  // Determine session directory
  let sessionDir: string;

  if (inPlace) {
    // Use current directory
    sessionDir = projectRoot;
    console.log(chalk.blue('\nUsing current directory (in-place mode)...'));
    console.log(chalk.green(`  Directory: ${sessionDir}`));
  } else {
    // Ensure sessions directory exists
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    // Get session directory
    sessionDir = getSessionDir(config, projectRoot, sessionId);

    // Create git worktree
    console.log(chalk.blue('\nCreating git worktree...'));
    await createWorktree(projectRoot, sessionDir, branchName);
    console.log(chalk.green(`  Created: ${sessionDir}`));

    // Copy .env files from source repo (if they exist) and update DATABASE_URL
    const sessionDbUrl = `postgresql://postgres:postgres@localhost:${ports.POSTGRES_PORT}/postgres`;
    const envFilesToCopy = config.envFiles ?? [];
    for (const envFile of envFilesToCopy) {
      const srcPath = join(projectRoot, envFile);
      const destPath = join(sessionDir, envFile);
      if (existsSync(srcPath)) {
        copyFileSync(srcPath, destPath);
        // Update DATABASE_URL to use session's postgres port
        updateEnvDatabaseUrl(destPath, sessionDbUrl);
        console.log(chalk.green(`  Copied: ${envFile} (updated DATABASE_URL)`));
      }
    }
  }

  // Write .env.session with ports (for docker-compose variable substitution)
  console.log(chalk.blue('\nGenerating .env.session...'));
  const projectName = config.projectName ?? basename(projectRoot);
  const envPath = writeEnvFile(sessionDir, sessionId, ports, projectName);
  console.log(chalk.green(`  Written: ${envPath}`));

  // Write app-specific .env.session files (for host CLI commands)
  const appEnvFiles = writeAppEnvFiles(config, sessionDir, sessionId, ports);
  for (const file of appEnvFiles) {
    console.log(chalk.green(`  Written: ${file}`));
  }

  // Start docker services
  // In docker mode: start requested app profiles (default: all)
  // In native mode: only infrastructure runs
  console.log(chalk.blue('\nStarting Docker services...'));
  let profiles: string[] | undefined;
  if (mode === 'docker') {
    const allApps = config.apps ?? [];
    const excludeApps = options.without ?? [];
    profiles = allApps.filter((app) => !excludeApps.includes(app));
    if (excludeApps.length > 0) {
      console.log(chalk.gray(`  Excluding apps: ${excludeApps.join(', ')}`));
    }
  }
  await docker.up({ cwd: sessionDir, profiles });

  // Wait for services to be healthy
  console.log(chalk.blue('Waiting for services to be ready...'));
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Run setup commands with session env vars
  if (config.setup.length > 0) {
    console.log(chalk.blue('\nRunning setup commands...'));

    // Build env with all ports for setup commands
    const setupEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      SESSION_ID: sessionId,
      // Add DATABASE_URL for db commands
      DATABASE_URL: `postgresql://postgres:postgres@localhost:${ports.POSTGRES_PORT}/postgres`,
    };
    // Add all port vars
    for (const [name, port] of Object.entries(ports)) {
      setupEnv[name] = String(port);
    }

    for (const cmd of config.setup) {
      console.log(chalk.gray(`  Running: ${cmd}`));
      const [command, ...args] = cmd.split(' ');
      try {
        await execa(command, args, {
          cwd: sessionDir,
          stdio: 'inherit',
          env: setupEnv,
        });
      } catch {
        console.warn(chalk.yellow(`  Warning: Command failed: ${cmd}`));
      }
    }
  }

  // Record session in DB (remove any old destroyed row first for UNIQUE constraint)
  store.remove(projectRoot, sessionId);
  try {
    store.insert({
      sessionId,
      projectRoot,
      sessionDir,
      branch: inPlace ? '' : branchName,
      mode,
      inPlace,
    });
  } catch (dbErr) {
    // DB insert failed — clean up artifacts and abort
    console.error(chalk.red('Failed to record session in database. Cleaning up...'));
    try { await docker.down({ cwd: sessionDir }); } catch { /* ignore */ }
    if (!inPlace) {
      try { await removeWorktree(projectRoot, sessionDir, branchName); } catch { /* ignore */ }
    }
    throw dbErr;
  }

  // Print success message
  console.log(chalk.green(`\nSession ${sessionId} ready!`));
  console.log(chalk.gray(`Directory: ${sessionDir}`));

  if (mode === 'docker') {
    console.log(chalk.gray('\nDocker mode - all services in containers.'));
    console.log(chalk.gray('View logs: docker compose -f docker-compose.session.yml logs -f'));
  } else {
    console.log(chalk.gray('\nNative mode - run apps with: pnpm dev'));
  }

  // Print access URLs
  console.log(chalk.gray('\nURLs:'));
  for (const [name, port] of Object.entries(ports)) {
    if (name.includes('APP') || name.includes('WEB') || name.includes('WIDGET')) {
      console.log(chalk.cyan(`  ${name}: http://localhost:${port}`));
    }
  }

  // If not detaching, stream logs from all services
  if (options.detach === false) {
    console.log(chalk.blue('\nStreaming logs (Ctrl+C to stop)...'));
    console.log(chalk.gray('─'.repeat(60)));
    try {
      await docker.logs({ cwd: sessionDir, profiles });
    } catch (error) {
      // User interrupted with Ctrl+C - this is expected
      const execaError = error as { signal?: string };
      if (execaError.signal === 'SIGINT') {
        console.log(chalk.gray('\n─'.repeat(60)));
        console.log(chalk.yellow('\nLog streaming stopped. Services are still running.'));
        console.log(chalk.gray(`Resume logs: cd ${sessionDir} && docker compose -f docker-compose.session.yml --env-file .env.session logs -f`));
      } else {
        throw error;
      }
    }
  }

  } finally {
    store.close();
  }
}

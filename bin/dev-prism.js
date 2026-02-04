#!/usr/bin/env node

import { Command } from 'commander';
import { createSession } from '../dist/commands/create.js';
import { destroySession } from '../dist/commands/destroy.js';
import { listSessions } from '../dist/commands/list.js';
import { installClaude } from '../dist/commands/claude.js';

const program = new Command();

program
  .name('dev-prism')
  .description('CLI tool for managing isolated parallel development sessions')
  .version('0.1.0');

program
  .command('create [sessionId]')
  .description('Create a new isolated development session')
  .option('-m, --mode <mode>', 'App mode: docker (default) or native', 'docker')
  .option('-b, --branch <branch>', 'Git branch name (default: session/YYYY-MM-DD/XXX)')
  .option('-W, --without <apps>', 'Exclude apps (comma-separated: app,web,widget)', (val) => val.split(','))
  .option('--no-detach', 'Stream container logs after starting (default: detach)')
  .option('--in-place', 'Run in current directory instead of creating a worktree')
  .action(async (sessionId, options) => {
    const projectRoot = process.cwd();
    await createSession(projectRoot, sessionId, {
      mode: options.mode,
      branch: options.branch,
      detach: options.detach,
      without: options.without,
      inPlace: options.inPlace,
    });
  });

program
  .command('destroy [sessionId]')
  .description('Destroy a development session')
  .option('-a, --all', 'Destroy all sessions')
  .action(async (sessionId, options) => {
    const projectRoot = process.cwd();
    await destroySession(projectRoot, sessionId, { all: options.all });
  });

program
  .command('list')
  .description('List all active development sessions')
  .action(async () => {
    const projectRoot = process.cwd();
    await listSessions(projectRoot);
  });

program
  .command('info')
  .description('Show session info for current directory (useful for --in-place sessions)')
  .action(async () => {
    const cwd = process.cwd();
    const chalk = (await import('chalk')).default;
    const { existsSync, readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const docker = await import('../dist/lib/docker.js');

    const envFile = resolve(cwd, '.env.session');
    if (!existsSync(envFile)) {
      console.log(chalk.yellow('No .env.session found in current directory.'));
      console.log(chalk.gray('Run `dev-prism create --in-place` to create a session here.'));
      process.exit(1);
    }

    // Parse .env.session
    const envContent = readFileSync(envFile, 'utf-8');
    const env = {};
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        env[match[1]] = match[2];
      }
    }

    const sessionId = env.SESSION_ID || 'unknown';
    const running = await docker.isRunning({ cwd });

    console.log(chalk.blue(`\nSession ${sessionId}`));
    console.log(chalk.gray(`Directory: ${cwd}`));
    console.log(running ? chalk.green('Status: running') : chalk.yellow('Status: stopped'));

    console.log(chalk.gray('\nPorts:'));
    for (const [key, value] of Object.entries(env)) {
      if (key.includes('PORT')) {
        console.log(chalk.gray(`  ${key}: ${value}`));
      }
    }

    console.log(chalk.gray('\nURLs:'));
    for (const [key, value] of Object.entries(env)) {
      if (key.includes('APP') || key.includes('WEB') || key.includes('WIDGET')) {
        if (key.includes('PORT')) {
          console.log(chalk.cyan(`  ${key.replace('_PORT', '')}: http://localhost:${value}`));
        }
      }
    }
    console.log('');
  });

program
  .command('start <sessionId>')
  .description('Start Docker services for a session')
  .option('-m, --mode <mode>', 'App mode: docker or native', 'docker')
  .option('-W, --without <apps>', 'Exclude apps (comma-separated: app,web,widget)', (val) => val.split(','))
  .action(async (sessionId, options) => {
    const projectRoot = process.cwd();
    const { loadConfig, getSessionDir } = await import('../dist/lib/config.js');
    const docker = await import('../dist/lib/docker.js');

    const config = await loadConfig(projectRoot);
    const sessionDir = getSessionDir(config, projectRoot, sessionId);
    let profiles;
    if (options.mode === 'docker') {
      const allApps = config.apps ?? ['app', 'web', 'widget'];
      const excludeApps = options.without ?? [];
      profiles = allApps.filter((app) => !excludeApps.includes(app));
    }

    await docker.up({ cwd: sessionDir, profiles });
  });

program
  .command('stop <sessionId>')
  .description('Stop Docker services for a session (without destroying)')
  .action(async (sessionId) => {
    const projectRoot = process.cwd();
    const { loadConfig, getSessionDir } = await import('../dist/lib/config.js');
    const { execa } = await import('execa');

    const config = await loadConfig(projectRoot);
    const sessionDir = getSessionDir(config, projectRoot, sessionId);

    // Use stop instead of down to preserve volumes
    await execa(
      'docker',
      ['compose', '-f', 'docker-compose.session.yml', '--env-file', '.env.session', 'stop'],
      { cwd: sessionDir, stdio: 'inherit' }
    );
  });

program
  .command('logs <sessionId>')
  .description('Stream logs from a session\'s Docker services')
  .option('-m, --mode <mode>', 'App mode: docker or native', 'docker')
  .option('-W, --without <apps>', 'Exclude apps (comma-separated: app,web,widget)', (val) => val.split(','))
  .option('-n, --tail <lines>', 'Number of lines to show from the end', '50')
  .action(async (sessionId, options) => {
    const projectRoot = process.cwd();
    const { loadConfig, getSessionDir } = await import('../dist/lib/config.js');
    const { execa } = await import('execa');

    const config = await loadConfig(projectRoot);
    const sessionDir = getSessionDir(config, projectRoot, sessionId);
    let profileFlags = [];
    if (options.mode === 'docker') {
      const allApps = config.apps ?? ['app', 'web', 'widget'];
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
      '--tail', options.tail,
    ];

    await execa('docker', args, { cwd: sessionDir, stdio: 'inherit' });
  });

program
  .command('stop-all')
  .description('Stop all running sessions (preserves data)')
  .action(async () => {
    const projectRoot = process.cwd();
    const chalk = (await import('chalk')).default;
    const { loadConfig, getSessionDir } = await import('../dist/lib/config.js');
    const { getSessionWorktrees } = await import('../dist/lib/worktree.js');
    const docker = await import('../dist/lib/docker.js');
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const config = await loadConfig(projectRoot);
    const sessions = await getSessionWorktrees(projectRoot);

    if (sessions.length === 0) {
      console.log(chalk.gray('No sessions found.'));
      return;
    }

    // Find running sessions
    const runningSessions = [];
    for (const session of sessions) {
      const envFile = resolve(session.path, '.env.session');
      if (existsSync(envFile)) {
        const running = await docker.isRunning({ cwd: session.path });
        if (running) {
          runningSessions.push(session);
        }
      }
    }

    if (runningSessions.length === 0) {
      console.log(chalk.gray('No running sessions found.'));
      return;
    }

    console.log(chalk.blue(`Stopping ${runningSessions.length} running session(s)...\n`));

    // Get all app profiles and service names to ensure we stop everything
    const allApps = config.apps ?? ['app', 'web', 'widget'];
    const profileFlags = allApps.flatMap((p) => ['--profile', p]);
    // Explicitly list all services to stop (infrastructure + apps)
    const allServices = ['postgres', 'mailpit', 'convas-app', 'convas-web', 'convas-widget'];

    const { execa } = await import('execa');
    for (const session of runningSessions) {
      console.log(chalk.gray(`  Stopping session ${session.sessionId}...`));
      try {
        await execa(
          'docker',
          ['compose', '-f', 'docker-compose.session.yml', '--env-file', '.env.session', ...profileFlags, 'stop', ...allServices],
          { cwd: session.path, stdio: 'pipe' }
        );
        console.log(chalk.green(`  Session ${session.sessionId} stopped.`));
      } catch (error) {
        console.log(chalk.yellow(`  Warning: Could not stop session ${session.sessionId}`));
      }
    }

    console.log(chalk.green(`\nStopped ${runningSessions.length} session(s).`));
  });

program
  .command('prune')
  .description('Remove all stopped sessions (destroys data)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (options) => {
    const projectRoot = process.cwd();
    const chalk = (await import('chalk')).default;
    const { loadConfig } = await import('../dist/lib/config.js');
    const { getSessionWorktrees, removeWorktree } = await import('../dist/lib/worktree.js');
    const docker = await import('../dist/lib/docker.js');
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const readline = await import('node:readline');

    const config = await loadConfig(projectRoot);
    const sessions = await getSessionWorktrees(projectRoot);

    if (sessions.length === 0) {
      console.log(chalk.gray('No sessions found.'));
      return;
    }

    // Find stopped sessions
    const stoppedSessions = [];
    for (const session of sessions) {
      const envFile = resolve(session.path, '.env.session');
      let running = false;
      if (existsSync(envFile)) {
        running = await docker.isRunning({ cwd: session.path });
      }
      if (!running) {
        stoppedSessions.push(session);
      }
    }

    if (stoppedSessions.length === 0) {
      console.log(chalk.gray('No stopped sessions to prune.'));
      return;
    }

    console.log(chalk.yellow(`\nFound ${stoppedSessions.length} stopped session(s) to prune:`));
    for (const session of stoppedSessions) {
      console.log(chalk.gray(`  - Session ${session.sessionId} (${session.branch})`));
    }
    console.log('');

    // Confirm unless --yes flag provided
    if (!options.yes) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise((resolve) => {
        rl.question(chalk.red('Are you sure you want to delete these sessions? This cannot be undone. [y/N] '), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(chalk.gray('Cancelled.'));
        return;
      }
    }

    console.log(chalk.blue('\nPruning stopped sessions...\n'));

    for (const session of stoppedSessions) {
      console.log(chalk.gray(`  Removing session ${session.sessionId}...`));
      try {
        // Clean up any docker resources
        const envFile = resolve(session.path, '.env.session');
        if (existsSync(envFile)) {
          try {
            await docker.down({ cwd: session.path });
          } catch {
            // Ignore errors - containers might already be removed
          }
        }
        // Remove worktree and branch
        await removeWorktree(projectRoot, session.path, session.branch);
        console.log(chalk.green(`  Session ${session.sessionId} removed.`));
      } catch (error) {
        console.log(chalk.yellow(`  Warning: Could not fully remove session ${session.sessionId}`));
      }
    }

    console.log(chalk.green(`\nPruned ${stoppedSessions.length} session(s).`));
  });

program
  .command('claude')
  .description('Install Claude Code integration (skill + CLAUDE.md)')
  .option('-f, --force', 'Overwrite existing files')
  .action(async (options) => {
    await installClaude(process.cwd(), { force: options.force });
  });

program
  .command('help')
  .description('Show detailed help and examples')
  .action(async () => {
    const chalk = (await import('chalk')).default;

    console.log(`
${chalk.bold('dev-prism')} - Manage isolated parallel development sessions

${chalk.bold('USAGE')}
  dev-prism <command> [options]

${chalk.bold('COMMANDS')}
  ${chalk.cyan('create')} [id]      Create a new session (auto-assigns ID if not provided)
  ${chalk.cyan('destroy')} <id>     Destroy a specific session
  ${chalk.cyan('list')}             List all sessions and their status
  ${chalk.cyan('info')}             Show session info for current directory
  ${chalk.cyan('start')} <id>       Start Docker services for a stopped session
  ${chalk.cyan('stop')} <id>        Stop Docker services (preserves data)
  ${chalk.cyan('stop-all')}         Stop all running sessions
  ${chalk.cyan('logs')} <id>        Stream logs from a session
  ${chalk.cyan('prune')}            Remove all stopped sessions

${chalk.bold('EXAMPLES')}
  ${chalk.gray('# Create a new session (auto-assigns next available ID)')}
  $ dev-prism create

  ${chalk.gray('# Create session with specific branch')}
  $ dev-prism create --branch feature/my-feature

  ${chalk.gray('# Create session in native mode (apps run on host)')}
  $ dev-prism create --mode native

  ${chalk.gray('# Create session without web app')}
  $ dev-prism create --without web

  ${chalk.gray('# Create session in current directory (no worktree)')}
  $ dev-prism create --in-place

  ${chalk.gray('# Check session status in current directory')}
  $ dev-prism info

  ${chalk.gray('# Stop all running sessions before switching context')}
  $ dev-prism stop-all

  ${chalk.gray('# Clean up old stopped sessions')}
  $ dev-prism prune

  ${chalk.gray('# Destroy all sessions')}
  $ dev-prism destroy --all

${chalk.bold('SESSION MODES')}
  ${chalk.cyan('docker')} (default)  All apps run in containers
  ${chalk.cyan('native')}            Only infrastructure in Docker, apps on host

${chalk.bold('MORE INFO')}
  Run ${chalk.cyan('dev-prism <command> --help')} for command-specific options
`);
  });

program.parse();

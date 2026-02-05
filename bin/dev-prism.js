#!/usr/bin/env node

import { Command } from 'commander';
import { createSession } from '../dist/commands/create.js';
import { destroySession } from '../dist/commands/destroy.js';
import { listSessions } from '../dist/commands/list.js';
import { installClaude } from '../dist/commands/claude.js';
import { showInfo } from '../dist/commands/info.js';
import { startSession } from '../dist/commands/start.js';
import { stopSession } from '../dist/commands/stop.js';
import { stopAllSessions } from '../dist/commands/stop-all.js';
import { pruneSessions } from '../dist/commands/prune.js';
import { streamLogs } from '../dist/commands/logs.js';

const program = new Command();

program
  .name('dev-prism')
  .description('CLI tool for managing isolated parallel development sessions')
  .version('0.2.0');

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
    await showInfo(process.cwd());
  });

program
  .command('start <sessionId>')
  .description('Start Docker services for a session')
  .option('-m, --mode <mode>', 'App mode: docker or native', 'docker')
  .option('-W, --without <apps>', 'Exclude apps (comma-separated: app,web,widget)', (val) => val.split(','))
  .action(async (sessionId, options) => {
    const projectRoot = process.cwd();
    await startSession(projectRoot, sessionId, {
      mode: options.mode,
      without: options.without,
    });
  });

program
  .command('stop <sessionId>')
  .description('Stop Docker services for a session (without destroying)')
  .action(async (sessionId) => {
    const projectRoot = process.cwd();
    await stopSession(projectRoot, sessionId);
  });

program
  .command('logs <sessionId>')
  .description('Stream logs from a session\'s Docker services')
  .option('-m, --mode <mode>', 'App mode: docker or native', 'docker')
  .option('-W, --without <apps>', 'Exclude apps (comma-separated: app,web,widget)', (val) => val.split(','))
  .option('-n, --tail <lines>', 'Number of lines to show from the end', '50')
  .action(async (sessionId, options) => {
    const projectRoot = process.cwd();
    await streamLogs(projectRoot, sessionId, {
      mode: options.mode,
      without: options.without,
      tail: options.tail,
    });
  });

program
  .command('stop-all')
  .description('Stop all running sessions (preserves data)')
  .action(async () => {
    const projectRoot = process.cwd();
    await stopAllSessions(projectRoot);
  });

program
  .command('prune')
  .description('Remove all stopped sessions (destroys data)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (options) => {
    const projectRoot = process.cwd();
    await pruneSessions(projectRoot, { yes: options.yes });
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

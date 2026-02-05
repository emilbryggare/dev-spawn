import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import * as docker from '../lib/docker.js';

export async function showInfo(cwd: string): Promise<void> {
  const envFile = resolve(cwd, '.env.session');
  if (!existsSync(envFile)) {
    console.log(chalk.yellow('No .env.session found in current directory.'));
    console.log(chalk.gray('Run `dev-prism create --in-place` to create a session here.'));
    process.exit(1);
  }

  // Parse .env.session
  const envContent = readFileSync(envFile, 'utf-8');
  const env: Record<string, string> = {};
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
}

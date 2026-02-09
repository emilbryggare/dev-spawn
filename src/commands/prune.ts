import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import {
  openDatabase,
  listDbSessions,
  deleteDbSession,
} from '../lib/db.js';

export interface PruneOptions {
  yes?: boolean;
}

export async function pruneSessions(options: PruneOptions): Promise<void> {
  const db = openDatabase();

  try {
    const sessions = listDbSessions(db);

    // Find orphaned sessions (directory no longer exists)
    const orphaned = sessions.filter((s) => !existsSync(s.id));

    if (orphaned.length === 0) {
      console.log(chalk.gray('No orphaned sessions to prune.'));
      return;
    }

    console.log(
      chalk.yellow(
        `\nFound ${orphaned.length} orphaned session(s) to prune:`
      )
    );
    for (const session of orphaned) {
      console.log(chalk.gray(`  - ${session.id}`));
    }
    console.log('');

    if (!options.yes) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          chalk.red('Remove these orphaned sessions from the database? [y/N] '),
          resolve
        );
      });
      rl.close();

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(chalk.gray('Cancelled.'));
        return;
      }
    }

    console.log(chalk.blue('\nPruning orphaned sessions...\n'));

    for (const session of orphaned) {
      console.log(chalk.gray(`  Removing ${session.id}...`));
      deleteDbSession(db, session.id);
      console.log(chalk.green(`  Removed.`));
    }

    console.log(
      chalk.green(`\nPruned ${orphaned.length} orphaned session(s).`)
    );
  } finally {
    db.close();
  }
}

import chalk from 'chalk';
import {
  openDatabase,
  listDbSessions,
  getPortAllocations,
} from '../lib/db.js';

export async function listSessions(): Promise<void> {
  const db = openDatabase();

  try {
    const sessions = listDbSessions(db);

    if (sessions.length === 0) {
      console.log(chalk.gray('No sessions found.'));
      console.log(chalk.gray('\nTo create a session:'));
      console.log(chalk.cyan('  dev-prism create'));
      return;
    }

    console.log(chalk.blue('Sessions:'));
    console.log(chalk.gray('=========\n'));

    for (const session of sessions) {
      const ports = getPortAllocations(db, session.id);

      console.log(chalk.white(`  ${session.id}`));
      if (session.branch) {
        console.log(chalk.gray(`    Branch: ${session.branch}`));
      }
      console.log(chalk.gray(`    Created: ${session.created_at}`));

      if (ports.length > 0) {
        console.log(chalk.gray('    Ports:'));
        for (const port of ports) {
          console.log(
            chalk.cyan(`      ${port.service}: ${port.port}`)
          );
        }
      }

      console.log('');
    }
  } finally {
    db.close();
  }
}

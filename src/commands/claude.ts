import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

const SKILL_CONTENT = `---
allowed-tools: Bash(dev-prism *)
description: Manage isolated development sessions (create, list, start, stop, destroy)
---

# Dev Session Manager

Manage isolated parallel development sessions using git worktrees and Docker.

## Parse Intent from: $ARGUMENTS

- "create" / "new" -> dev-prism create
- "list" / "status" -> dev-prism list
- "start <id>" -> dev-prism start <id>
- "stop <id>" -> dev-prism stop <id>
- "destroy <id>" -> dev-prism destroy <id>
- "logs <id>" -> dev-prism logs <id>
- "stop all" -> dev-prism stop-all
- "prune" -> dev-prism prune

## Commands

Run from the project root (where session.config.mjs exists).

After running commands, explain:
1. What happened
2. Relevant ports/paths
3. Next steps

Warn before destructive operations (destroy, prune).
`;

const CLAUDE_MD_SECTION = `
## Dev Sessions

Isolated parallel development sessions using git worktrees and Docker.

### Commands
\`\`\`bash
dev-prism create [id]      # Create session (auto-assigns ID)
dev-prism list             # Show all sessions with status
dev-prism start <id>       # Start stopped session
dev-prism stop <id>        # Stop session (preserves data)
dev-prism stop-all         # Stop all running sessions
dev-prism destroy <id>     # Remove session completely
dev-prism logs <id>        # Stream Docker logs
dev-prism prune            # Remove stopped sessions
\`\`\`

### Port Allocation
Port = 47000 + (sessionId × 100) + offset

| Service | Offset | Session 001 |
|---------|--------|-------------|
| APP     | 0      | 47100       |
| WEB     | 1      | 47101       |
| POSTGRES| 10     | 47110       |

### AI Notes
- In sessions, use DATABASE_URL from \`.env.session\`
- Run \`dev-prism list\` to discover ports
- Commands run from project root, not session worktrees
`;

export interface ClaudeOptions {
  force?: boolean;
}

export async function installClaude(projectRoot: string, options: ClaudeOptions): Promise<void> {
  const skillDir = join(projectRoot, '.claude', 'commands');
  const skillPath = join(skillDir, 'session.md');
  const claudeMdPath = join(projectRoot, 'CLAUDE.md');

  // Create skill
  if (existsSync(skillPath) && !options.force) {
    console.log(chalk.yellow(`Skill already exists: ${skillPath}`));
    console.log(chalk.gray('Use --force to overwrite'));
  } else {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, SKILL_CONTENT);
    console.log(chalk.green(`Created: ${skillPath}`));
  }

  // Update CLAUDE.md
  const marker = '## Dev Sessions';
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, 'utf-8');
    if (content.includes(marker)) {
      if (options.force) {
        // Replace existing section
        const beforeSection = content.split(marker)[0];
        writeFileSync(claudeMdPath, beforeSection.trimEnd() + CLAUDE_MD_SECTION);
        console.log(chalk.green(`Updated: ${claudeMdPath}`));
      } else {
        console.log(chalk.yellow('CLAUDE.md already has Dev Sessions section'));
        console.log(chalk.gray('Use --force to overwrite'));
      }
    } else {
      appendFileSync(claudeMdPath, CLAUDE_MD_SECTION);
      console.log(chalk.green(`Updated: ${claudeMdPath}`));
    }
  } else {
    writeFileSync(claudeMdPath, `# Project\n${CLAUDE_MD_SECTION}`);
    console.log(chalk.green(`Created: ${claudeMdPath}`));
  }

  console.log(chalk.blue('\nClaude Code integration installed!'));
  console.log(chalk.gray('Use /session in Claude Code to manage sessions.'));
}

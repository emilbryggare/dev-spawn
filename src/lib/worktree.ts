import { existsSync, rmSync } from 'node:fs';
import { execa } from 'execa';

async function branchExists(projectRoot: string, branchName: string): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--verify', branchName], {
      cwd: projectRoot,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function findNextSessionId(usedIds: Set<string>): string {
  for (let i = 1; i <= 999; i++) {
    const sessionId = String(i).padStart(3, '0');
    if (!usedIds.has(sessionId)) {
      return sessionId;
    }
  }
  throw new Error('No available session IDs (001-999 all in use)');
}

export function generateDefaultBranchName(sessionId: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `session/${today}/${sessionId}`;
}

export async function createWorktree(
  projectRoot: string,
  sessionDir: string,
  branchName: string
): Promise<void> {
  // Check if worktree already exists
  if (existsSync(sessionDir)) {
    throw new Error(`Session directory already exists: ${sessionDir}`);
  }

  const exists = await branchExists(projectRoot, branchName);

  if (exists) {
    // Attach to existing branch
    await execa('git', ['worktree', 'add', sessionDir, branchName], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
  } else {
    // Create worktree with new branch from HEAD
    await execa('git', ['worktree', 'add', sessionDir, '-b', branchName, 'HEAD'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
  }
}

export async function removeWorktree(
  projectRoot: string,
  sessionDir: string,
  branchName: string
): Promise<void> {
  // Check if worktree exists
  if (existsSync(sessionDir)) {
    // Force remove worktree
    try {
      await execa('git', ['worktree', 'remove', '--force', sessionDir], {
        cwd: projectRoot,
        stdio: 'inherit',
      });
    } catch {
      // If git worktree remove fails, manually remove the directory
      rmSync(sessionDir, { recursive: true, force: true });
    }
  }

  // Delete the branch
  try {
    await execa('git', ['branch', '-D', branchName], {
      cwd: projectRoot,
      stdio: 'pipe', // Don't show output, branch might not exist
    });
  } catch {
    // Branch might not exist, ignore error
  }
}

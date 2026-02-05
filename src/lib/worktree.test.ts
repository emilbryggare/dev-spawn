import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateDefaultBranchName, findNextSessionId } from './worktree.js';

describe('generateDefaultBranchName', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates branch name with date and session ID', () => {
    vi.setSystemTime(new Date('2024-03-15'));
    const result = generateDefaultBranchName('001');
    expect(result).toBe('session/2024-03-15/001');
  });

  it('includes session ID in branch name', () => {
    vi.setSystemTime(new Date('2024-01-01'));
    const result = generateDefaultBranchName('042');
    expect(result).toBe('session/2024-01-01/042');
  });
});

describe('findNextSessionId', () => {
  it('returns 001 when no IDs are used', () => {
    const result = findNextSessionId(new Set());
    expect(result).toBe('001');
  });

  it('returns next available ID', () => {
    const result = findNextSessionId(new Set(['001', '002']));
    expect(result).toBe('003');
  });

  it('skips used IDs and finds gap', () => {
    const result = findNextSessionId(new Set(['001', '003']));
    expect(result).toBe('002');
  });

  it('throws when all IDs are used', () => {
    const allIds = new Set<string>();
    for (let i = 1; i <= 999; i++) {
      allIds.add(String(i).padStart(3, '0'));
    }
    expect(() => findNextSessionId(allIds)).toThrow('No available session IDs');
  });
});

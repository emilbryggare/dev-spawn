import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from './store.js';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('insert', () => {
    it('inserts a session and returns the row', () => {
      const row = store.insert({
        sessionId: '001',
        projectRoot: '/projects/my-app',
        sessionDir: '/sessions/session-001',
        branch: 'session/2025-01-01/001',
        mode: 'docker',
        inPlace: false,
      });

      expect(row.id).toBe(1);
      expect(row.session_id).toBe('001');
      expect(row.project_root).toBe('/projects/my-app');
      expect(row.session_dir).toBe('/sessions/session-001');
      expect(row.branch).toBe('session/2025-01-01/001');
      expect(row.mode).toBe('docker');
      expect(row.in_place).toBe(0);
      expect(row.destroyed_at).toBeNull();
    });

    it('uses defaults for optional fields', () => {
      const row = store.insert({
        sessionId: '002',
        projectRoot: '/projects/my-app',
        sessionDir: '/projects/my-app',
      });

      expect(row.branch).toBe('');
      expect(row.mode).toBe('docker');
      expect(row.in_place).toBe(0);
    });

    it('sets in_place flag', () => {
      const row = store.insert({
        sessionId: '003',
        projectRoot: '/projects/my-app',
        sessionDir: '/projects/my-app',
        inPlace: true,
      });

      expect(row.in_place).toBe(1);
    });

    it('rejects duplicate session_id + project_root', () => {
      store.insert({
        sessionId: '001',
        projectRoot: '/projects/my-app',
        sessionDir: '/sessions/session-001',
      });

      expect(() =>
        store.insert({
          sessionId: '001',
          projectRoot: '/projects/my-app',
          sessionDir: '/sessions/session-001-dup',
        })
      ).toThrow(/UNIQUE constraint/);
    });

    it('allows same session_id in different projects', () => {
      store.insert({
        sessionId: '001',
        projectRoot: '/projects/app-a',
        sessionDir: '/sessions/a/session-001',
      });

      const row = store.insert({
        sessionId: '001',
        projectRoot: '/projects/app-b',
        sessionDir: '/sessions/b/session-001',
      });

      expect(row.session_id).toBe('001');
    });
  });

  describe('listByProject', () => {
    it('returns active sessions for a project', () => {
      store.insert({ sessionId: '001', projectRoot: '/p', sessionDir: '/s/001' });
      store.insert({ sessionId: '002', projectRoot: '/p', sessionDir: '/s/002' });
      store.insert({ sessionId: '003', projectRoot: '/other', sessionDir: '/s/003' });

      const sessions = store.listByProject('/p');
      expect(sessions).toHaveLength(2);
      expect(sessions[0].session_id).toBe('001');
      expect(sessions[1].session_id).toBe('002');
    });

    it('excludes destroyed sessions', () => {
      store.insert({ sessionId: '001', projectRoot: '/p', sessionDir: '/s/001' });
      store.insert({ sessionId: '002', projectRoot: '/p', sessionDir: '/s/002' });
      store.markDestroyed('/p', '001');

      const sessions = store.listByProject('/p');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe('002');
    });
  });

  describe('listAll', () => {
    it('returns all active sessions across projects', () => {
      store.insert({ sessionId: '001', projectRoot: '/a', sessionDir: '/s/a/001' });
      store.insert({ sessionId: '001', projectRoot: '/b', sessionDir: '/s/b/001' });

      const sessions = store.listAll();
      expect(sessions).toHaveLength(2);
    });
  });

  describe('findSession', () => {
    it('finds an active session by project and id', () => {
      store.insert({ sessionId: '001', projectRoot: '/p', sessionDir: '/s/001' });

      const session = store.findSession('/p', '001');
      expect(session).toBeDefined();
      expect(session!.session_id).toBe('001');
    });

    it('returns undefined for destroyed sessions', () => {
      store.insert({ sessionId: '001', projectRoot: '/p', sessionDir: '/s/001' });
      store.markDestroyed('/p', '001');

      expect(store.findSession('/p', '001')).toBeUndefined();
    });

    it('returns undefined for non-existent sessions', () => {
      expect(store.findSession('/p', '999')).toBeUndefined();
    });
  });

  describe('findByDir', () => {
    it('finds a session by directory', () => {
      store.insert({ sessionId: '001', projectRoot: '/p', sessionDir: '/s/001' });

      const session = store.findByDir('/s/001');
      expect(session).toBeDefined();
      expect(session!.session_id).toBe('001');
    });

    it('returns undefined for unknown directory', () => {
      expect(store.findByDir('/unknown')).toBeUndefined();
    });
  });

  describe('getUsedSessionIds', () => {
    it('returns set of active session ids', () => {
      store.insert({ sessionId: '001', projectRoot: '/p', sessionDir: '/s/001' });
      store.insert({ sessionId: '003', projectRoot: '/p', sessionDir: '/s/003' });
      store.insert({ sessionId: '005', projectRoot: '/p', sessionDir: '/s/005' });
      store.markDestroyed('/p', '003');

      const ids = store.getUsedSessionIds('/p');
      expect(ids).toEqual(new Set(['001', '005']));
    });
  });

  describe('markDestroyed', () => {
    it('marks session as destroyed and returns true', () => {
      store.insert({ sessionId: '001', projectRoot: '/p', sessionDir: '/s/001' });

      const result = store.markDestroyed('/p', '001');
      expect(result).toBe(true);

      // Should no longer appear in active queries
      expect(store.findSession('/p', '001')).toBeUndefined();
    });

    it('returns false for non-existent session', () => {
      expect(store.markDestroyed('/p', '999')).toBe(false);
    });

    it('returns false if already destroyed', () => {
      store.insert({ sessionId: '001', projectRoot: '/p', sessionDir: '/s/001' });
      store.markDestroyed('/p', '001');

      expect(store.markDestroyed('/p', '001')).toBe(false);
    });
  });

  describe('remove', () => {
    it('permanently deletes a session row', () => {
      store.insert({ sessionId: '001', projectRoot: '/p', sessionDir: '/s/001' });

      const result = store.remove('/p', '001');
      expect(result).toBe(true);
      expect(store.findSession('/p', '001')).toBeUndefined();
    });

    it('returns false for non-existent session', () => {
      expect(store.remove('/p', '999')).toBe(false);
    });
  });
});

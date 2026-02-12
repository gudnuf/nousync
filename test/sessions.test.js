import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore } from '../packages/agent/sessions.js';

describe('createSessionStore', () => {
  it('creates a session and retrieves history', () => {
    const store = createSessionStore();
    try {
      const id = store.createSession();
      assert.ok(id, 'should return a session id');
      assert.equal(store.getHistory(id).length, 0);

      store.addExchange(id, 'What is Nix?', 'A package manager.');
      const history = store.getHistory(id);
      assert.equal(history.length, 1);
      assert.equal(history[0].question, 'What is Nix?');
      assert.equal(history[0].response, 'A package manager.');
      assert.ok(history[0].timestamp);
    } finally {
      store.destroy();
    }
  });

  it('supports multiple exchanges', () => {
    const store = createSessionStore();
    try {
      const id = store.createSession();
      store.addExchange(id, 'Q1', 'A1');
      store.addExchange(id, 'Q2', 'A2');
      store.addExchange(id, 'Q3', 'A3');

      const history = store.getHistory(id);
      assert.equal(history.length, 3);
      assert.equal(history[2].question, 'Q3');
    } finally {
      store.destroy();
    }
  });

  it('auto-expires sessions with short TTL', async () => {
    const store = createSessionStore({ ttl: 50, cleanupInterval: 20 });
    try {
      const id = store.createSession();
      assert.equal(store.getActiveCount(), 1);

      // Wait for expiry
      await new Promise(r => setTimeout(r, 120));

      assert.equal(store.getActiveCount(), 0);
      assert.throws(() => store.getHistory(id), /Unknown session/);
    } finally {
      store.destroy();
    }
  });

  it('manually expires a session', () => {
    const store = createSessionStore();
    try {
      const id = store.createSession();
      assert.equal(store.getActiveCount(), 1);

      store.expireSession(id);
      assert.equal(store.getActiveCount(), 0);
      assert.throws(() => store.getHistory(id), /Unknown session/);
    } finally {
      store.destroy();
    }
  });

  it('throws on unknown session id', () => {
    const store = createSessionStore();
    try {
      assert.throws(() => store.getHistory('nonexistent'), /Unknown session/);
      assert.throws(() => store.addExchange('nonexistent', 'q', 'a'), /Unknown session/);
      assert.throws(() => store.expireSession('nonexistent'), /Unknown session/);
    } finally {
      store.destroy();
    }
  });

  it('destroy clears all sessions and interval', () => {
    const store = createSessionStore();
    store.createSession();
    store.createSession();
    assert.equal(store.getActiveCount(), 2);

    store.destroy();
    assert.equal(store.getActiveCount(), 0);
  });

  it('tracks separate sessions independently', () => {
    const store = createSessionStore();
    try {
      const id1 = store.createSession();
      const id2 = store.createSession();

      store.addExchange(id1, 'Q for session 1', 'A1');
      store.addExchange(id2, 'Q for session 2', 'A2');

      assert.equal(store.getHistory(id1).length, 1);
      assert.equal(store.getHistory(id2).length, 1);
      assert.equal(store.getHistory(id1)[0].question, 'Q for session 1');
      assert.equal(store.getHistory(id2)[0].question, 'Q for session 2');
    } finally {
      store.destroy();
    }
  });
});

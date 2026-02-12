import { randomUUID } from 'node:crypto';

export function createSessionStore({ ttl = 600_000, cleanupInterval = 60_000 } = {}) {
  const sessions = new Map();

  const interval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > ttl) {
        sessions.delete(id);
      }
    }
  }, cleanupInterval);

  // Don't block process exit
  interval.unref();

  return {
    createSession() {
      const id = randomUUID();
      sessions.set(id, {
        id,
        history: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      });
      return id;
    },

    addExchange(id, question, response) {
      const session = sessions.get(id);
      if (!session) throw new Error(`Unknown session: ${id}`);
      session.history.push({ question, response, timestamp: Date.now() });
      session.lastActivity = Date.now();
    },

    getHistory(id) {
      const session = sessions.get(id);
      if (!session) throw new Error(`Unknown session: ${id}`);
      return session.history;
    },

    expireSession(id) {
      if (!sessions.has(id)) throw new Error(`Unknown session: ${id}`);
      sessions.delete(id);
    },

    getActiveCount() {
      return sessions.size;
    },

    destroy() {
      clearInterval(interval);
      sessions.clear();
    },
  };
}

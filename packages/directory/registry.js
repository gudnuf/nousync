import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createRegistry(persistPath, { offlineThreshold = 90_000, cleanupInterval = 15_000 } = {}) {
  const agents = new Map();

  // Load persisted state on cold start (all marked offline)
  try {
    const data = JSON.parse(readFileSync(persistPath, 'utf8'));
    for (const entry of data) {
      entry.status = 'offline';
      agents.set(entry.agent_id, entry);
    }
  } catch {
    // No persisted state or corrupt file — start fresh
  }

  function persist() {
    try {
      mkdirSync(dirname(persistPath), { recursive: true });
      writeFileSync(persistPath, JSON.stringify([...agents.values()], null, 2));
    } catch {
      // Non-fatal: persistence is best-effort
    }
  }

  const interval = setInterval(() => {
    const now = Date.now();
    for (const agent of agents.values()) {
      if (agent.status === 'online' && now - agent.last_heartbeat > offlineThreshold) {
        agent.status = 'offline';
      }
    }
  }, cleanupInterval);
  interval.unref();

  return {
    register({ agent_id, display_name, connection_key, expertise_index, payment }) {
      const now = Date.now();
      const existing = agents.get(agent_id);
      const entry = {
        agent_id,
        display_name,
        connection_key,
        expertise_index: expertise_index || null,
        payment: payment || null,
        status: 'online',
        registered_at: existing?.registered_at || now,
        last_heartbeat: now,
      };
      agents.set(agent_id, entry);
      persist();
      return entry;
    },

    heartbeat(agent_id) {
      const agent = agents.get(agent_id);
      if (!agent) return false;
      agent.last_heartbeat = Date.now();
      agent.status = 'online';
      return true;
    },

    get(agent_id) {
      return agents.get(agent_id) || null;
    },

    getOnlineAgents() {
      return [...agents.values()].filter(a => a.status === 'online');
    },

    counts() {
      let online = 0;
      for (const a of agents.values()) {
        if (a.status === 'online') online++;
      }
      return { total: agents.size, online };
    },

    destroy() {
      clearInterval(interval);
      agents.clear();
    },
  };
}

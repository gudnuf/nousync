import express from 'express';
import { createRegistry } from './registry.js';
import { createPaymentMiddleware } from '../core/payment.js';
import { log } from '../core/log.js';

export function createDirectoryServer({ registryPath, wallet, config, client, model }) {
  const app = express();
  const registry = createRegistry(registryPath);
  const startTime = Date.now();

  app.use(express.json());

  // Payment gate on /connect only
  app.use(createPaymentMiddleware(wallet, config || {}, { gatePaths: ['/connect'] }));

  app.post('/register', (req, res, next) => {
    try {
      const { agent_id, display_name, connection_key, expertise_index, payment } = req.body;

      if (!agent_id || typeof agent_id !== 'string') {
        res.status(400).json({ error: 'agent_id is required and must be a string' });
        return;
      }
      if (!connection_key || typeof connection_key !== 'string') {
        res.status(400).json({ error: 'connection_key is required and must be a string' });
        return;
      }

      const entry = registry.register({ agent_id, display_name, connection_key, expertise_index, payment });
      log('\ud83d\udce1', 'Agent registered', `${display_name || agent_id}`);
      res.json({ registered: true, agent_id: entry.agent_id });
    } catch (err) {
      next(err);
    }
  });

  app.post('/heartbeat', (req, res, next) => {
    try {
      const { agent_id } = req.body;

      if (!agent_id || typeof agent_id !== 'string') {
        res.status(400).json({ error: 'agent_id is required and must be a string' });
        return;
      }

      const ok = registry.heartbeat(agent_id);
      if (!ok) {
        res.status(404).json({ error: 'Unknown agent' });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/discover', async (req, res, next) => {
    try {
      const { query } = req.body;

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'query is required and must be a string' });
        return;
      }

      log('\ud83d\udd0d', 'Discovery query', query);

      // Phase 3 wires in discoverAgents here
      const { discoverAgents } = await import('./discovery.js');
      const result = await discoverAgents(query, registry.getOnlineAgents(), { client, model });

      log('\u2705', `Discovery complete`, `${result.recommendations.length} recommendation(s)`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/connect', (req, res, next) => {
    try {
      const { agent_id } = req.body;

      if (!agent_id || typeof agent_id !== 'string') {
        res.status(400).json({ error: 'agent_id is required and must be a string' });
        return;
      }

      const agent = registry.get(agent_id);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      if (agent.status !== 'online') {
        res.status(410).json({ error: 'Agent is offline' });
        return;
      }

      log('\ud83d\udd17', 'Connect requested', agent.display_name || agent_id);
      res.json({ connection_key: agent.connection_key, display_name: agent.display_name });
    } catch (err) {
      next(err);
    }
  });

  app.get('/status', (req, res) => {
    const counts = registry.counts();
    res.json({
      status: 'ok',
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      agents: counts,
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error(`Error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.destroy = () => registry.destroy();

  return app;
}

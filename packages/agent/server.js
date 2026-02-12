import express from 'express';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { retrieveRelevantSessions } from '../core/retrieval.js';
import { synthesize } from './synthesizer.js';
import { createSessionStore } from './sessions.js';
import { createPaymentMiddleware } from './payment.js';

export function createAgentServer({ agentId, displayName, sessionsDir, indexPath, client, model, wallet, config }) {
  const app = express();
  const store = createSessionStore();
  const startTime = Date.now();

  app.use(express.json());

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // Payment gate (no-op when payment disabled)
  app.use(createPaymentMiddleware(wallet, config || {}));

  app.post('/ask', async (req, res, next) => {
    try {
      const { question, session_id, context } = req.body;

      if (!question || typeof question !== 'string') {
        res.status(400).json({ error: 'question is required and must be a string' });
        return;
      }

      // Retrieve relevant sessions
      const retrieved = await retrieveRelevantSessions(question, sessionsDir, indexPath);

      // Build conversation history from session store
      let conversationHistory = [];
      let sessionId = session_id;

      if (sessionId) {
        try {
          const history = store.getHistory(sessionId);
          conversationHistory = history.flatMap(h => [
            { role: 'user', content: h.question },
            { role: 'assistant', content: h.response },
          ]);
        } catch {
          // Unknown session, create new one
          sessionId = null;
        }
      }

      if (!sessionId) {
        sessionId = store.createSession();
      }

      // Synthesize response
      const result = await synthesize(question, retrieved.sessions, {
        context,
        conversationHistory,
        client,
        model,
      });

      // Store exchange
      store.addExchange(sessionId, question, result.response);

      res.json({
        response: result.response,
        confidence: result.confidence,
        based_on_sessions: result.based_on_sessions,
        session_id: sessionId,
        followup_available: result.followup_available,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/profile', (req, res, next) => {
    try {
      let domains = [];
      let sessionCount = 0;

      if (indexPath) {
        try {
          const content = readFileSync(indexPath, 'utf8');
          const index = yaml.load(content);
          domains = (index.domains || []).map(d => ({
            name: d.name,
            depth: d.depth,
            tags: d.tags,
          }));
          sessionCount = index.session_count || 0;
        } catch {
          // Index not available
        }
      }

      const profile = {
        agent_id: agentId,
        display_name: displayName,
        domains,
        session_count: sessionCount,
        status: 'available',
      };

      if (config?.payment?.enabled) {
        profile.payment = {
          amount: config.payment.amount,
          unit: config.payment.unit,
        };
      }

      res.json(profile);
    } catch (err) {
      next(err);
    }
  });

  app.get('/status', (req, res) => {
    res.json({
      status: 'ok',
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      active_consultations: store.getActiveCount(),
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error(`Error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.destroy = () => store.destroy();

  return app;
}

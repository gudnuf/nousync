import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentServer } from '../packages/agent/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, 'fixtures', 'seed-sessions');
const INDEX_PATH = join(SEED_DIR, 'expertise_index.yaml');

function createMockClient(response) {
  return {
    messages: {
      create: async () => ({
        content: [{
          type: 'tool_use',
          id: 'toolu_mock',
          name: 'synthesize_response',
          input: response || {
            response: 'Based on my experience with Nix flakes, you should use direnv.',
            confidence: 'high',
            based_on_sessions: ['0c5c4f5a-a2d0-48fd-bb63-645124c42a7b'],
            followup_available: true,
          },
        }],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    },
  };
}

function startApp(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({ server, baseUrl, port });
    });
  });
}

describe('createAgentServer', () => {
  let server;
  let app;

  afterEach(() => {
    if (app) app.destroy();
    if (server) server.close();
    app = null;
    server = null;
  });

  it('POST /ask returns synthesized response', async () => {
    app = createAgentServer({
      agentId: 'test-agent',
      displayName: 'Test Agent',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'How do I set up a Nix flake?' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.response);
    assert.ok(body.confidence);
    assert.ok(body.session_id);
    assert.ok(Array.isArray(body.based_on_sessions));
    assert.equal(typeof body.followup_available, 'boolean');
  });

  it('POST /ask supports follow-up with session_id', async () => {
    app = createAgentServer({
      agentId: 'test-agent',
      displayName: 'Test Agent',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    // First question
    const res1 = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'How do I set up a Nix flake?' }),
    });
    const body1 = await res1.json();
    const sessionId = body1.session_id;

    // Follow-up with session_id
    const res2 = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'What about direnv integration?',
        session_id: sessionId,
      }),
    });

    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.session_id, sessionId, 'should maintain same session');
  });

  it('POST /ask returns 400 for missing question', async () => {
    app = createAgentServer({
      agentId: 'test-agent',
      displayName: 'Test Agent',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('GET /profile returns agent profile', async () => {
    app = createAgentServer({
      agentId: 'test-agent',
      displayName: 'Test Agent',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/profile`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.agent_id, 'test-agent');
    assert.equal(body.display_name, 'Test Agent');
    assert.ok(Array.isArray(body.domains));
    assert.ok(body.domains.length > 0, 'should load domains from index');
    assert.equal(body.session_count, 3);
    assert.equal(body.status, 'available');
  });

  it('GET /status returns server status', async () => {
    app = createAgentServer({
      agentId: 'test-agent',
      displayName: 'Test Agent',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/status`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime_seconds, 'number');
    assert.equal(typeof body.active_consultations, 'number');
  });

  it('handles server errors gracefully', async () => {
    // Client that throws
    const badClient = {
      messages: {
        create: async () => { throw new Error('API failure'); },
      },
    };

    app = createAgentServer({
      agentId: 'test-agent',
      displayName: 'Test Agent',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: badClient,
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'test' }),
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.ok(body.error);
  });
});

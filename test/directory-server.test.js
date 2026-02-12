import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createDirectoryServer } from '../packages/directory/server.js';

function tmpPath() {
  const dir = mkdtempSync(join(tmpdir(), 'nousync-test-'));
  return { dir, path: join(dir, 'registry.json') };
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

function createMockClient() {
  return {
    messages: {
      create: async () => ({
        content: [{
          type: 'tool_use',
          id: 'toolu_mock',
          name: 'recommend_agents',
          input: {
            recommendations: [{
              agent_id: 'agent-1',
              relevance_score: 0.9,
              reasoning: 'Strong nix expertise',
              matching_domains: [{ name: 'nix', depth: 'deep', tags: ['nix', 'flakes'] }],
            }],
          },
        }],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    },
  };
}

const AGENT = {
  agent_id: 'agent-1',
  display_name: 'Nix Expert',
  connection_key: 'hs://abc123',
  expertise_index: {
    domains: [{
      name: 'nix',
      depth: 'deep',
      tags: ['nix', 'flakes', 'direnv'],
      insights: ['Nix flakes provide reproducible dev environments'],
    }],
  },
};

describe('directory server', () => {
  let server;
  let app;
  let tmp;

  afterEach(() => {
    if (app) app.destroy();
    if (server) server.close();
    if (tmp) rmSync(tmp.dir, { recursive: true, force: true });
    app = null;
    server = null;
    tmp = null;
  });

  it('POST /register succeeds', async () => {
    tmp = tmpPath();
    app = createDirectoryServer({ registryPath: tmp.path, client: createMockClient() });
    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(AGENT),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.registered, true);
    assert.equal(body.agent_id, 'agent-1');
  });

  it('POST /register returns 400 on missing fields', async () => {
    tmp = tmpPath();
    app = createDirectoryServer({ registryPath: tmp.path, client: createMockClient() });
    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res1 = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Test' }),
    });
    assert.equal(res1.status, 400);

    const res2 = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'test' }),
    });
    assert.equal(res2.status, 400);
  });

  it('POST /heartbeat succeeds and 404s for unknown', async () => {
    tmp = tmpPath();
    app = createDirectoryServer({ registryPath: tmp.path, client: createMockClient() });
    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    // Register first
    await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(AGENT),
    });

    // Heartbeat for known agent
    const res = await fetch(`${baseUrl}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'agent-1' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // Heartbeat for unknown agent
    const res2 = await fetch(`${baseUrl}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'no-such-agent' }),
    });
    assert.equal(res2.status, 404);
  });

  it('GET /status returns agent counts', async () => {
    tmp = tmpPath();
    app = createDirectoryServer({ registryPath: tmp.path, client: createMockClient() });
    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    // Register an agent
    await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(AGENT),
    });

    const res = await fetch(`${baseUrl}/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime_seconds, 'number');
    assert.deepEqual(body.agents, { total: 1, online: 1 });
  });

  it('POST /connect returns connection_key for online agent', async () => {
    tmp = tmpPath();
    app = createDirectoryServer({ registryPath: tmp.path, client: createMockClient() });
    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    // Register
    await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(AGENT),
    });

    const res = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'agent-1' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connection_key, 'hs://abc123');
    assert.equal(body.display_name, 'Nix Expert');
  });

  it('POST /connect returns 404 for missing agent', async () => {
    tmp = tmpPath();
    app = createDirectoryServer({ registryPath: tmp.path, client: createMockClient() });
    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'no-such-agent' }),
    });
    assert.equal(res.status, 404);
  });

  it('POST /connect returns 410 for offline agent', async () => {
    tmp = tmpPath();
    app = createDirectoryServer({ registryPath: tmp.path, client: createMockClient() });
    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    // Register then force offline
    await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(AGENT),
    });

    // Hack: access internal state via GET /status to confirm online, then
    // we need to manipulate. Use a second register with same id + manually offline.
    // For this test, create a server with very short offline threshold
    app.destroy();
    server.close();

    app = createDirectoryServer({
      registryPath: tmp.path,
      client: createMockClient(),
    });
    // Agent loaded from persistence as offline
    const { server: srv2, baseUrl: baseUrl2 } = await startApp(app);
    server = srv2;

    const res = await fetch(`${baseUrl2}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'agent-1' }),
    });
    assert.equal(res.status, 410);
  });
});

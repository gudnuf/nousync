import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from 'cbor-x';
import { getEncodedToken } from 'coco-cashu-core';
import { encodePaymentRequest, tokenAmount, createPaymentMiddleware } from '../packages/core/payment.js';
import { createAgentServer } from '../packages/agent/server.js';

// Valid 100 sat test token
const VALID_TOKEN = getEncodedToken({
  mint: 'https://mint.example.com',
  proofs: [{ amount: 100, id: '009a1f293253e41e', secret: 'test-100', C: '02deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }],
});

// 10 sat token (insufficient for 100 sat requirement)
const SMALL_TOKEN = getEncodedToken({
  mint: 'https://mint.example.com',
  proofs: [{ amount: 10, id: '009a1f293253e41e', secret: 'test-10', C: '02deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, 'fixtures', 'seed-sessions');
const INDEX_PATH = join(SEED_DIR, 'expertise_index.yaml');

function createMockClient() {
  return {
    messages: {
      create: async () => ({
        content: [{
          type: 'tool_use',
          id: 'toolu_mock',
          name: 'synthesize_response',
          input: {
            response: 'Test response.',
            confidence: 'high',
            based_on_sessions: ['abc'],
            followup_available: false,
          },
        }],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    },
  };
}

function createMockWallet({ shouldFail = false } = {}) {
  return {
    receive: async (token) => {
      if (shouldFail) throw new Error('Invalid token');
    },
    getBalances: async () => ({ 'https://mint.example.com': 500 }),
    send: async () => 'cashuBmock...',
    destroy: async () => {},
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

describe('encodePaymentRequest', () => {
  it('encodes and decodes a NUT-18 payment request', () => {
    const encoded = encodePaymentRequest(100, 'sat', ['https://mint.example.com']);

    assert.ok(encoded.startsWith('creqA'), 'should start with creqA prefix');

    // Decode and verify roundtrip
    const cborBytes = Buffer.from(encoded.slice(5), 'base64url');
    const decoded = decode(cborBytes);

    assert.equal(decoded.a, 100);
    assert.equal(decoded.u, 'sat');
    assert.equal(decoded.m.length, 1);
    assert.equal(decoded.m[0].u, 'https://mint.example.com');
  });

  it('encodes multiple mints', () => {
    const encoded = encodePaymentRequest(50, 'sat', [
      'https://mint1.example.com',
      'https://mint2.example.com',
    ]);

    const decoded = decode(Buffer.from(encoded.slice(5), 'base64url'));
    assert.equal(decoded.m.length, 2);
  });
});

describe('tokenAmount', () => {
  it('extracts amount from a valid V4 token', () => {
    assert.equal(tokenAmount(VALID_TOKEN), 100);
    assert.equal(tokenAmount(SMALL_TOKEN), 10);
  });

  it('throws on invalid token string', () => {
    assert.throws(() => tokenAmount('garbage'));
  });
});

describe('payment middleware', () => {
  let server;
  let app;

  afterEach(() => {
    if (app) app.destroy();
    if (server) server.close();
    app = null;
    server = null;
  });

  it('passes through when payment disabled', async () => {
    app = createAgentServer({
      agentId: 'test',
      displayName: 'Test',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
      config: { payment: { enabled: false } },
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'test question' }),
    });

    assert.equal(res.status, 200);
  });

  it('returns 402 when no token provided', async () => {
    const config = {
      payment: { enabled: true, amount: 100, unit: 'sat', mints: ['https://mint.example.com'] },
    };

    app = createAgentServer({
      agentId: 'test',
      displayName: 'Test',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
      wallet: createMockWallet(),
      config,
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'test question' }),
    });

    assert.equal(res.status, 402);

    const body = await res.json();
    assert.equal(body.error, 'Payment required');
    assert.equal(body.amount, 100);
    assert.equal(body.unit, 'sat');

    const paymentReq = res.headers.get('x-cashu');
    assert.ok(paymentReq.startsWith('creqA'));
  });

  it('returns 200 when valid token provided', async () => {
    const config = {
      payment: { enabled: true, amount: 100, unit: 'sat', mints: ['https://mint.example.com'] },
    };

    app = createAgentServer({
      agentId: 'test',
      displayName: 'Test',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
      wallet: createMockWallet(),
      config,
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cashu': VALID_TOKEN,
      },
      body: JSON.stringify({ question: 'test question' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.response);
  });

  it('returns 400 when bad token provided', async () => {
    const config = {
      payment: { enabled: true, amount: 100, unit: 'sat', mints: ['https://mint.example.com'] },
    };

    app = createAgentServer({
      agentId: 'test',
      displayName: 'Test',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
      wallet: createMockWallet({ shouldFail: true }),
      config,
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cashu': VALID_TOKEN,
      },
      body: JSON.stringify({ question: 'test question' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('Payment failed'));
  });

  it('returns 400 for unparseable token', async () => {
    const config = {
      payment: { enabled: true, amount: 100, unit: 'sat', mints: ['https://mint.example.com'] },
    };

    app = createAgentServer({
      agentId: 'test',
      displayName: 'Test',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
      wallet: createMockWallet(),
      config,
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cashu': 'not-a-real-token',
      },
      body: JSON.stringify({ question: 'test question' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('Invalid'));
  });

  it('returns 402 for insufficient token amount', async () => {
    const config = {
      payment: { enabled: true, amount: 100, unit: 'sat', mints: ['https://mint.example.com'] },
    };

    app = createAgentServer({
      agentId: 'test',
      displayName: 'Test',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
      wallet: createMockWallet(),
      config,
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cashu': SMALL_TOKEN,
      },
      body: JSON.stringify({ question: 'test question' }),
    });

    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.error, 'Insufficient payment');
    assert.equal(body.required, 100);
    assert.equal(body.received, 10);
  });

  it('does not gate non-ask routes', async () => {
    const config = {
      payment: { enabled: true, amount: 100, unit: 'sat', mints: ['https://mint.example.com'] },
    };

    app = createAgentServer({
      agentId: 'test',
      displayName: 'Test',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
      wallet: createMockWallet(),
      config,
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const profileRes = await fetch(`${baseUrl}/profile`);
    assert.equal(profileRes.status, 200);

    const statusRes = await fetch(`${baseUrl}/status`);
    assert.equal(statusRes.status, 200);
  });

  it('includes payment info in /profile when enabled', async () => {
    const config = {
      payment: { enabled: true, amount: 100, unit: 'sat', mints: ['https://mint.example.com'] },
    };

    app = createAgentServer({
      agentId: 'test',
      displayName: 'Test',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: createMockClient(),
      wallet: createMockWallet(),
      config,
    });

    const { server: srv, baseUrl } = await startApp(app);
    server = srv;

    const res = await fetch(`${baseUrl}/profile`);
    const body = await res.json();
    assert.deepEqual(body.payment, { amount: 100, unit: 'sat' });
  });
});

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRegistry } from '../packages/directory/registry.js';

function tmpPath() {
  const dir = mkdtempSync(join(tmpdir(), 'nousync-test-'));
  return { dir, path: join(dir, 'registry.json') };
}

const AGENT = {
  agent_id: 'agent-1',
  display_name: 'Test Agent',
  connection_key: 'hs://abc123',
  expertise_index: { domains: [{ name: 'nix', tags: ['nix', 'flakes'] }] },
  payment: { amount: 100, unit: 'sat' },
};

describe('createRegistry', () => {
  let registry;
  let tmp;

  afterEach(() => {
    if (registry) registry.destroy();
    if (tmp) rmSync(tmp.dir, { recursive: true, force: true });
    registry = null;
    tmp = null;
  });

  it('register + get roundtrip', () => {
    tmp = tmpPath();
    registry = createRegistry(tmp.path);

    registry.register(AGENT);
    const got = registry.get('agent-1');

    assert.equal(got.agent_id, 'agent-1');
    assert.equal(got.display_name, 'Test Agent');
    assert.equal(got.connection_key, 'hs://abc123');
    assert.equal(got.status, 'online');
    assert.ok(got.registered_at > 0);
    assert.ok(got.last_heartbeat > 0);
  });

  it('heartbeat updates timestamp, returns false for unknown', () => {
    tmp = tmpPath();
    registry = createRegistry(tmp.path);

    registry.register(AGENT);
    const before = registry.get('agent-1').last_heartbeat;

    // Small delay to ensure timestamp difference
    const ok = registry.heartbeat('agent-1');
    assert.equal(ok, true);
    assert.ok(registry.get('agent-1').last_heartbeat >= before);

    const unknown = registry.heartbeat('no-such-agent');
    assert.equal(unknown, false);
  });

  it('detects offline agents after threshold', async () => {
    tmp = tmpPath();
    registry = createRegistry(tmp.path, { offlineThreshold: 50, cleanupInterval: 10 });

    registry.register(AGENT);
    assert.equal(registry.get('agent-1').status, 'online');

    // Wait for threshold + cleanup cycle
    await new Promise(r => setTimeout(r, 100));

    assert.equal(registry.get('agent-1').status, 'offline');
  });

  it('counts are accurate', () => {
    tmp = tmpPath();
    registry = createRegistry(tmp.path);

    assert.deepEqual(registry.counts(), { total: 0, online: 0 });

    registry.register(AGENT);
    assert.deepEqual(registry.counts(), { total: 1, online: 1 });

    registry.register({ ...AGENT, agent_id: 'agent-2', connection_key: 'hs://def456' });
    assert.deepEqual(registry.counts(), { total: 2, online: 2 });
  });

  it('getOnlineAgents filters offline', () => {
    tmp = tmpPath();
    registry = createRegistry(tmp.path);

    registry.register(AGENT);
    registry.register({ ...AGENT, agent_id: 'agent-2', connection_key: 'hs://def456' });

    // Manually set one offline
    registry.get('agent-2').status = 'offline';

    const online = registry.getOnlineAgents();
    assert.equal(online.length, 1);
    assert.equal(online[0].agent_id, 'agent-1');
  });

  it('persists and reloads as offline on cold start', () => {
    tmp = tmpPath();
    registry = createRegistry(tmp.path);
    registry.register(AGENT);
    registry.destroy();

    // New registry from same file
    registry = createRegistry(tmp.path);
    const got = registry.get('agent-1');
    assert.ok(got, 'should load persisted agent');
    assert.equal(got.status, 'offline', 'should be offline on cold start');
    assert.equal(got.display_name, 'Test Agent');
  });

  it('destroy clears state', () => {
    tmp = tmpPath();
    registry = createRegistry(tmp.path);
    registry.register(AGENT);
    registry.destroy();

    assert.equal(registry.get('agent-1'), null);
    assert.deepEqual(registry.counts(), { total: 0, online: 0 });

    // Prevent double-destroy in afterEach
    registry = null;
  });
});

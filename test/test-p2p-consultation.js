import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentServer } from '../packages/agent/server.js';
import { startNetwork } from '../packages/core/network.js';
import { AgentClient } from '../packages/client/connector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, 'fixtures', 'seed-sessions');
const INDEX_PATH = join(SEED_DIR, 'expertise_index.yaml');

function createMockClient() {
  let callCount = 0;
  return {
    messages: {
      create: async (params) => {
        callCount++;
        // Vary response based on conversation history length
        const hasHistory = params.messages.length > 1;
        return {
          content: [{
            type: 'tool_use',
            id: `toolu_mock_${callCount}`,
            name: 'synthesize_response',
            input: {
              response: hasHistory
                ? 'Following up: direnv integrates with Nix flakes via "use flake" in .envrc.'
                : 'Based on my experience, Nix flakes with direnv provide reproducible dev environments.',
              confidence: 'high',
              based_on_sessions: ['0c5c4f5a-a2d0-48fd-bb63-645124c42a7b'],
              followup_available: !hasHistory,
            },
          }],
          usage: { input_tokens: 100, output_tokens: 200 },
        };
      },
    },
  };
}

describe('P2P consultation integration test', { timeout: 30_000 }, () => {
  let app;
  let network;
  let client;

  after(async () => {
    if (client) await client.disconnect().catch(() => {});
    if (network) await network.stop().catch(() => {});
    if (app) app.destroy();
  });

  it('full consultation flow over Holesail tunnel', async () => {
    // 1. Create agent server with mock client pointing at seed sessions
    const mockClient = createMockClient();
    app = createAgentServer({
      agentId: 'nousync-agent-1',
      displayName: 'Nousync Test Agent',
      sessionsDir: SEED_DIR,
      indexPath: INDEX_PATH,
      client: mockClient,
    });

    // 2. Start Holesail network
    console.log('Starting Holesail server...');
    network = await startNetwork(app);
    console.log(`Holesail server ready: ${network.url}`);
    assert.ok(network.url, 'should have a Holesail URL');
    assert.ok(network.port > 0, 'should have a port');
    assert.ok(network.publicKey, 'should have a public key');

    // 3. Connect client via Holesail
    console.log('Connecting client...');
    client = new AgentClient(network.url);
    await client.connect();
    assert.ok(client.connected, 'client should be connected');
    console.log(`Client connected on port ${client.localPort}`);

    // 4. Ask a question matching seed session topics
    console.log('Asking question...');
    const answer1 = await client.ask('How do I set up a Nix flake with direnv?');

    assert.ok(answer1.response, 'should have a response');
    assert.ok(answer1.confidence, 'should have confidence');
    assert.ok(answer1.session_id, 'should have session_id');
    assert.ok(Array.isArray(answer1.based_on_sessions), 'should have based_on_sessions');
    assert.equal(typeof answer1.followup_available, 'boolean');
    console.log(`Answer 1: ${answer1.response.substring(0, 80)}...`);

    // 5. Follow-up question (session should be maintained)
    console.log('Asking follow-up...');
    const answer2 = await client.ask('What goes in the .envrc file?');

    assert.ok(answer2.response);
    assert.equal(answer2.session_id, answer1.session_id, 'should maintain same session');
    console.log(`Answer 2: ${answer2.response.substring(0, 80)}...`);

    // 6. Test /profile through tunnel
    console.log('Getting profile...');
    const profile = await client.getProfile();

    assert.equal(profile.agent_id, 'nousync-agent-1');
    assert.equal(profile.display_name, 'Nousync Test Agent');
    assert.ok(Array.isArray(profile.domains));
    assert.ok(profile.domains.length > 0, 'should have domains from index');
    assert.equal(profile.session_count, 3);
    console.log(`Profile: ${profile.display_name} with ${profile.domains.length} domains`);

    // 7. Test /status through tunnel
    console.log('Getting status...');
    const status = await client.getStatus();

    assert.equal(status.status, 'ok');
    assert.equal(typeof status.uptime_seconds, 'number');
    assert.ok(status.active_consultations >= 1, 'should have at least 1 active consultation');
    console.log(`Status: ${status.status}, uptime: ${status.uptime_seconds}s, active: ${status.active_consultations}`);

    // 8. Clean shutdown
    console.log('Shutting down...');
    await client.disconnect();
    assert.equal(client.connected, false);

    await network.stop();
    app.destroy();

    // Prevent double-cleanup in after()
    client = null;
    network = null;
    app = null;

    console.log('P2P consultation test complete.');
  });
});

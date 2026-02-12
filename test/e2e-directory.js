#!/usr/bin/env node
// E2E test: directory server + registration + discovery (no Holesail, HTTP only)

import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createDirectoryServer } from '../packages/directory/server.js';
import { createAgentServer } from '../packages/agent/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, 'fixtures', 'seed-sessions');
const INDEX_PATH = join(SEED_DIR, 'expertise_index.yaml');

const tmp = mkdtempSync(join(tmpdir(), 'nousync-e2e-'));
const registryPath = join(tmp, 'registry.json');

function createMockClient() {
  return {
    messages: {
      create: async (params) => ({
        content: [{
          type: 'tool_use',
          id: 'toolu_mock',
          name: params.tools[0].name,
          input: params.tools[0].name === 'recommend_agents'
            ? {
                recommendations: [{
                  agent_id: 'test-agent',
                  relevance_score: 0.95,
                  reasoning: 'Deep nix expertise with flakes and direnv experience across multiple sessions',
                  matching_domains: [{ name: 'Nix Development Environments', depth: 'working', tags: ['nix', 'direnv'] }],
                }],
              }
            : {
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

const mockClient = createMockClient();

// 1. Start directory server
const dirApp = createDirectoryServer({ registryPath, client: mockClient });
const dirServer = createServer(dirApp);
await new Promise(r => dirServer.listen(0, '127.0.0.1', r));
const dirUrl = `http://127.0.0.1:${dirServer.address().port}`;
console.log(`Directory server: ${dirUrl}`);

// 2. Start agent server
const agentApp = createAgentServer({
  agentId: 'test-agent',
  displayName: 'Nix & Git Expert',
  sessionsDir: SEED_DIR,
  indexPath: INDEX_PATH,
  client: mockClient,
});
const agentServer = createServer(agentApp);
await new Promise(r => agentServer.listen(0, '127.0.0.1', r));
const agentUrl = `http://127.0.0.1:${agentServer.address().port}`;
console.log(`Agent server: ${agentUrl}`);

// 3. Register agent with directory (simulates what bin/serve.js does)
const expertiseIndex = yaml.load(readFileSync(INDEX_PATH, 'utf8'));
const regRes = await fetch(`${dirUrl}/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent_id: 'test-agent',
    display_name: 'Nix & Git Expert',
    connection_key: agentUrl,  // In real use this would be hs://...
    expertise_index: expertiseIndex,
  }),
});
const regBody = await regRes.json();
console.log(`\nRegistration: ${JSON.stringify(regBody)}`);

// 4. Check directory status
const statusRes = await fetch(`${dirUrl}/status`);
const statusBody = await statusRes.json();
console.log(`Directory status: ${JSON.stringify(statusBody)}`);

// 5. Discover agents
console.log('\n--- Discovery: "how do I set up nix flakes with direnv" ---');
const discRes = await fetch(`${dirUrl}/discover`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'how do I set up nix flakes with direnv' }),
});
const discBody = await discRes.json();
for (const rec of discBody.recommendations) {
  console.log(`  ${rec.agent_id} (score: ${rec.relevance_score})`);
  console.log(`    ${rec.reasoning}`);
  if (rec.matching_domains) {
    console.log(`    Domains: ${rec.matching_domains.map(d => d.name).join(', ')}`);
  }
}

// 6. Connect to discovered agent
console.log('\n--- Connect to discovered agent ---');
const connectRes = await fetch(`${dirUrl}/connect`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ agent_id: discBody.recommendations[0].agent_id }),
});
const connectBody = await connectRes.json();
console.log(`Connection key: ${connectBody.connection_key}`);
console.log(`Display name: ${connectBody.display_name}`);

// 7. Ask the agent a question through its connection
console.log('\n--- Ask agent via connection ---');
const askRes = await fetch(`${connectBody.connection_key}/ask`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'How do I set up a Nix flake with direnv?' }),
});
const askBody = await askRes.json();
console.log(`Response: ${askBody.response}`);
console.log(`Confidence: ${askBody.confidence}`);

// Cleanup
agentApp.destroy();
agentServer.close();
dirApp.destroy();
dirServer.close();
rmSync(tmp, { recursive: true, force: true });

console.log('\nE2E test complete!');

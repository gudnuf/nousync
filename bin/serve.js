#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentServer } from '../packages/agent/server.js';
import { startNetwork } from '../packages/agent/network.js';
import { sessionsDir, indexesDir, ensureApiKey } from '../packages/core/paths.js';

ensureApiKey();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: Run "nousync init" first, or set ANTHROPIC_API_KEY');
  process.exit(1);
}

const sessions = sessionsDir();
const indexPath = join(indexesDir(), 'global_expertise_index.yaml');

if (!existsSync(sessions)) {
  console.error(`Error: sessions directory not found: ${sessions}`);
  process.exit(1);
}

if (!existsSync(indexPath)) {
  console.error(`Warning: index not found: ${indexPath}`);
}

const app = createAgentServer({
  agentId: 'local',
  displayName: 'Nousync Local Agent',
  sessionsDir: sessions,
  indexPath,
});

const network = await startNetwork(app);
console.log(network.url);

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await network.stop();
  process.exit(0);
});

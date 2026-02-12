#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentServer } from '../packages/agent/server.js';
import { startNetwork, getOrCreateSeed } from '../packages/agent/network.js';
import { sessionsDir, indexesDir, seedPath, ensureApiKey, loadConfig } from '../packages/core/paths.js';

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

const config = loadConfig();

let wallet = null;
if (config.payment?.enabled) {
  const { createWallet } = await import('../packages/agent/wallet.js');
  wallet = await createWallet(config);
  console.log(`Payment enabled: ${config.payment.amount} ${config.payment.unit} per question`);
}

const app = createAgentServer({
  agentId: 'local',
  displayName: 'Nousync Local Agent',
  sessionsDir: sessions,
  indexPath,
  wallet,
  config,
});

const seed = getOrCreateSeed(seedPath());
const network = await startNetwork(app, { seed });
console.log(network.url);

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await network.stop();
  if (wallet) await wallet.destroy();
  process.exit(0);
});

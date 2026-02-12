#!/usr/bin/env node

import { join } from 'node:path';
import { createDirectoryServer } from '../packages/directory/server.js';
import { startNetwork, getOrCreateSeed } from '../packages/core/network.js';
import { directoryDataDir, ensureApiKey, loadConfig } from '../packages/core/paths.js';

ensureApiKey();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: Run "nousync init" first, or set ANTHROPIC_API_KEY');
  process.exit(1);
}

const config = loadConfig();
const dataDir = directoryDataDir({ ensure: true });
const registryPath = join(dataDir, 'registry.json');
const seedFile = join(dataDir, 'server.seed');

let wallet = null;
if (config.payment?.enabled) {
  const { createWallet } = await import('../packages/core/wallet.js');
  wallet = await createWallet(config);
  console.log(`Payment enabled: ${config.payment.amount} ${config.payment.unit} per connection`);
}

const { default: Anthropic } = await import('@anthropic-ai/sdk');
const client = new Anthropic();
const model = 'claude-sonnet-4-5-20250929';

const app = createDirectoryServer({ registryPath, wallet, config, client, model });

const seed = getOrCreateSeed(seedFile);
const network = await startNetwork(app, { seed });
console.log(network.url);

process.on('SIGINT', async () => {
  console.log('\nShutting down directory...');
  await network.stop();
  if (wallet) await wallet.destroy();
  app.destroy();
  process.exit(0);
});

#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { createAgentServer } from '../packages/agent/server.js';
import { startNetwork, getOrCreateSeed } from '../packages/core/network.js';
import { sessionsDir, indexesDir, seedPath, ensureApiKey, loadConfig, DIRECTORY_URL } from '../packages/core/paths.js';
import { DirectoryClient } from '../packages/directory/client.js';
import { log } from '../packages/core/log.js';

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
  const { createWallet } = await import('../packages/core/wallet.js');
  wallet = await createWallet(config);
}

// Read session count from index
let sessionCount = 0;
if (existsSync(indexPath)) {
  try {
    const idx = yaml.load(readFileSync(indexPath, 'utf8'));
    sessionCount = idx?.session_count || 0;
  } catch {}
}

const agentId = config.agent_id || 'local';
const displayName = config.display_name || 'Nousync Local Agent';

const app = createAgentServer({
  agentId,
  displayName,
  sessionsDir: sessions,
  indexPath,
  wallet,
  config,
});

const seed = getOrCreateSeed(seedPath());
const network = await startNetwork(app, { seed });

// Startup banner
const paymentLine = config.payment?.enabled
  ? `${config.payment.amount} ${config.payment.unit}/question`
  : 'free';
console.log(`
\x1b[1m\x1b[36m  nousync agent\x1b[0m
  \x1b[2mname\x1b[0m      ${displayName}
  \x1b[2murl\x1b[0m       ${network.url}
  \x1b[2msessions\x1b[0m  ${sessionCount}
  \x1b[2mpayment\x1b[0m   ${paymentLine}
`);

// Auto-register with directory
let dirClient = null;
let heartbeatInterval = null;

if (DIRECTORY_URL && !DIRECTORY_URL.includes('TBD')) {
  try {
    dirClient = new DirectoryClient(DIRECTORY_URL);
    await dirClient.connect();

    // Build registration payload from expertise index
    let expertiseIndex = null;
    if (existsSync(indexPath)) {
      try {
        expertiseIndex = yaml.load(readFileSync(indexPath, 'utf8'));
      } catch {
        // Index not readable
      }
    }

    await dirClient.register({
      agent_id: agentId,
      display_name: displayName,
      connection_key: network.url,
      expertise_index: expertiseIndex,
      payment: config.payment?.enabled ? { amount: config.payment.amount, unit: config.payment.unit } : null,
    });
    log('\ud83d\udce1', 'Registered with directory');

    // Heartbeat every 30s
    heartbeatInterval = setInterval(async () => {
      try {
        await dirClient.heartbeat(agentId);
      } catch {
        // Non-fatal: directory may be temporarily unavailable
      }
    }, 30_000);
    heartbeatInterval.unref();
  } catch (err) {
    log('\u26a0\ufe0f', 'Directory registration failed', err.message);
    dirClient = null;
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (dirClient) await dirClient.disconnect().catch(() => {});
  await network.stop();
  if (wallet) await wallet.destroy();
  process.exit(0);
});

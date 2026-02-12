import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { initializeCoco, getEncodedToken } from 'coco-cashu-core';
import { SqliteRepositories } from 'coco-cashu-sqlite3';
import Database from 'better-sqlite3';
import { nousyncHome } from '../core/paths.js';

function getOrCreateSeed(seedFile) {
  try {
    const hex = readFileSync(seedFile, 'utf8').trim();
    return Buffer.from(hex, 'hex');
  } catch {
    // Coco expects a 64-byte seed (BIP39-style)
    const seed = randomBytes(64);
    mkdirSync(dirname(seedFile), { recursive: true });
    writeFileSync(seedFile, seed.toString('hex') + '\n', { mode: 0o600 });
    return seed;
  }
}

export async function createWallet(config) {
  const home = nousyncHome();
  const seedFile = join(home, 'wallet-seed');
  const dbPath = join(home, 'wallet.db');

  const seed = getOrCreateSeed(seedFile);
  const db = new Database(dbPath);
  const repo = new SqliteRepositories({ database: db });

  const coco = await initializeCoco({
    repo,
    seedGetter: async () => new Uint8Array(seed),
  });

  // Add configured mints as trusted
  const mints = config.payment?.mints || [];
  for (const mintUrl of mints) {
    try {
      await coco.mint.addMint(mintUrl, { trusted: true });
    } catch {
      // Already added or mint unreachable at startup — not fatal
    }
  }

  return {
    async receive(token) {
      await coco.wallet.receive(token);
    },

    async getBalances() {
      return coco.wallet.getBalances();
    },

    async send(mintUrl, amount) {
      const prepared = await coco.send.prepareSend(mintUrl, amount);
      const { token } = await coco.send.executePreparedSend(prepared.id);
      return getEncodedToken(token);
    },

    async destroy() {
      await coco.dispose();
      db.close();
    },
  };
}

#!/usr/bin/env node

import { walletCommand } from '../packages/agent/wallet-cli.js';

const args = process.argv.slice(2);
walletCommand(args).catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

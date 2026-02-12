#!/usr/bin/env node

const command = process.argv[2];

const HELP = `nousync - P2P knowledge network for Claude Code agents

Commands:
  init     Set up nousync (first-time or add new sessions)
  serve    Start sharing your knowledge over P2P
  ask      Query a running nousync agent
  wallet   Manage cashu wallet (balance, withdraw)

Run 'nousync <command> --help' for details on each command.`;

if (!command || command === '--help' || command === '-h') {
  console.log(HELP);
  process.exit(0);
}

const commands = {
  init:   () => import('./init.js'),
  serve:  () => import('./serve.js'),
  ask:    () => import('./ask.js'),
  wallet: () => import('./wallet.js'),
};

if (!commands[command]) {
  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(1);
}

// Shift argv so subcommands see their own args at argv[2]
process.argv.splice(1, 1);
await commands[command]();

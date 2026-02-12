import { createWallet } from '../core/wallet.js';
import { loadConfig } from '../core/paths.js';

export async function walletCommand(args) {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(`Usage:
  nousync wallet balance    Show balance per mint
  nousync wallet withdraw <amount>  Print a cashu token to stdout`);
    return;
  }

  const config = loadConfig();
  if (!config.payment?.enabled) {
    console.error('Error: payment not configured. Add a payment section to ~/.nousync/config.yaml');
    process.exit(1);
  }

  const wallet = await createWallet(config);

  try {
    if (subcommand === 'balance') {
      const balances = await wallet.getBalances();
      const entries = Object.entries(balances);
      if (entries.length === 0) {
        console.log('No balance.');
        return;
      }
      for (const [mint, amount] of entries) {
        console.log(`${mint}: ${amount} ${config.payment.unit || 'sat'}`);
      }
    } else if (subcommand === 'withdraw') {
      const amount = parseInt(args[1], 10);
      if (!amount || amount <= 0) {
        console.error('Usage: nousync wallet withdraw <amount>');
        process.exit(1);
      }
      const mints = config.payment.mints;
      if (!mints?.length) {
        console.error('Error: no mints configured');
        process.exit(1);
      }
      const token = await wallet.send(mints[0], amount);
      console.log(token);
    } else {
      console.error(`Unknown wallet subcommand: ${subcommand}`);
      process.exit(1);
    }
  } finally {
    await wallet.destroy();
  }

  process.exit(0);
}

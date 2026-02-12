#!/usr/bin/env node

import { DIRECTORY_URL } from '../packages/core/paths.js';
import { DirectoryClient } from '../packages/directory/client.js';

const query = process.argv.slice(2).join(' ');

if (!query || query === '--help' || query === '-h') {
  console.log(`Usage: nousync discover <query>

Find agents by expertise. Queries the directory server using
natural language to find the best matching agents.

Example:
  nousync discover "how do I set up nix flakes with direnv"`);
  process.exit(0);
}

if (!DIRECTORY_URL || DIRECTORY_URL.includes('TBD')) {
  console.error('Error: DIRECTORY_URL not configured. Run a directory server first and update packages/core/paths.js');
  process.exit(1);
}

const client = new DirectoryClient(DIRECTORY_URL);

try {
  console.log('Connecting to directory...');
  await client.connect();

  const result = await client.discover(query);

  if (result.recommendations.length === 0) {
    console.log('No matching agents found.');
  } else {
    console.log(`\nFound ${result.recommendations.length} matching agent(s):\n`);
    for (const rec of result.recommendations) {
      console.log(`  ${rec.agent_id} (score: ${rec.relevance_score.toFixed(2)})`);
      console.log(`    ${rec.reasoning}`);
      if (rec.matching_domains?.length > 0) {
        const domains = rec.matching_domains.map(d => d.name).join(', ');
        console.log(`    Domains: ${domains}`);
      }
      console.log();
    }
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
} finally {
  await client.disconnect();
}

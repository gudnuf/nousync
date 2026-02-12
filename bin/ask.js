#!/usr/bin/env node

import { AgentClient } from '../packages/client/connector.js';

const args = process.argv.slice(2);

function usage() {
  console.error(`Usage: node bin/ask.js <hs://key> <question>
       node bin/ask.js <hs://key> --profile
       node bin/ask.js <hs://key> --status
       node bin/ask.js <hs://key> --session <id> <question>`);
  process.exit(1);
}

if (args.length < 2) usage();

const url = args[0];
const flags = args.slice(1);

async function withClient(fn) {
  const client = new AgentClient(url, { timeout: 120_000 });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

async function run() {
  if (flags[0] === '--profile') {
    const result = await withClient(c => c.getProfile());
    console.log(`Agent: ${result.display_name} (${result.agent_id})`);
    console.log(`Sessions: ${result.session_count}`);
    console.log(`Status: ${result.status}`);
    if (result.domains?.length) {
      console.log(`Domains:`);
      for (const d of result.domains) {
        console.log(`  - ${d.name} (${d.depth}) [${d.tags?.join(', ') || ''}]`);
      }
    }
    return;
  }

  if (flags[0] === '--status') {
    const result = await withClient(c => c.getStatus());
    console.log(`Status: ${result.status}`);
    console.log(`Uptime: ${result.uptime_seconds}s`);
    console.log(`Active consultations: ${result.active_consultations}`);
    return;
  }

  // Parse --session flag
  let sessionId = null;
  let question;
  const sessionIdx = flags.indexOf('--session');
  if (sessionIdx !== -1) {
    sessionId = flags[sessionIdx + 1];
    question = flags.filter((_, i) => i !== sessionIdx && i !== sessionIdx + 1).join(' ');
  } else {
    question = flags.join(' ');
  }

  if (!question) usage();

  const result = await withClient(c => c.ask(question, { sessionId }));

  console.log(result.response);
  console.log(`\n---`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Based on: ${result.based_on_sessions.join(', ') || 'none'}`);
  if (result.session_id) {
    console.log(`Session: ${result.session_id}`);
  }
}

run().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

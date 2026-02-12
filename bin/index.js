#!/usr/bin/env node

import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { buildIndex } from '../packages/core/index-builder.js';
import { sessionsDir, indexesDir, ensureApiKey } from '../packages/core/paths.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`nousync index - Rebuild expertise index from distilled sessions

Clusters your distilled sessions into expertise domains using Claude.
Run this after 'nousync init' or when you want to refresh domains.`);
  process.exit(0);
}

ensureApiKey();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: Run "nousync init" first, or set ANTHROPIC_API_KEY');
  process.exit(1);
}

const sessions = sessionsDir();
const files = readdirSync(sessions).filter(f => f.endsWith('.md'));

if (files.length === 0) {
  console.error('No distilled sessions found. Run "nousync init" first.');
  process.exit(1);
}

console.log(`Building expertise index from ${files.length} sessions...`);

const outPath = join(indexesDir({ ensure: true }), 'global_expertise_index.yaml');
const index = await buildIndex(sessions, outPath);

console.log(`${index.domains?.length || 0} expertise domains identified`);
for (const d of index.domains || []) {
  console.log(`  ${d.name} (${d.depth}) - ${d.tags.length} tags, ${d.sessions.length} sessions`);
}
console.log(`\nSaved to ${outPath}`);

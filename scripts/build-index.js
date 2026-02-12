#!/usr/bin/env node
// Usage: node scripts/build-index.js [sessions-dir]
//
// Reads distilled session logs (*.md) from a directory,
// clusters them into expertise domains, and writes expertise_index.yaml.
//
// If no dir given, uses ~/.nousphere/sessions/ (where distill-one.js --save writes).
// Pass --dry-run to skip the API call and just list what would be indexed.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../packages/core/index-builder.js';
import { parse } from '../packages/core/schema.js';
import { sessionsDir as defaultSessionsDir, indexesDir } from '../packages/core/paths.js';

// Load .env
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  const sessionsDir = args[0] || defaultSessionsDir();

  if (!existsSync(sessionsDir)) {
    console.error(`Directory not found: ${sessionsDir}`);
    console.error('\nDistill some sessions first:');
    console.error('  node scripts/distill-one.js --save');
    process.exit(1);
  }

  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) {
    console.error(`No .md files found in ${sessionsDir}`);
    process.exit(1);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`SESSIONS (${files.length} files in ${sessionsDir})`);
  console.log(`${'─'.repeat(60)}\n`);

  for (const file of files) {
    try {
      const content = readFileSync(join(sessionsDir, file), 'utf8');
      const { frontmatter: fm } = parse(content);
      console.log(`  ${file}`);
      console.log(`    project: ${fm.project || '(none)'}  task: ${fm.task || '(none)'}`);
      console.log(`    outcome: ${fm.outcome || '(none)'}  tags: ${(fm.tags || []).join(', ')}`);
      console.log();
    } catch {
      console.log(`  ${file}  (parse error)`);
    }
  }

  if (dryRun) {
    console.log('--dry-run: skipping API call.\n');
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY to build the index (or use --dry-run).\n');
    process.exit(1);
  }

  const outputPath = join(indexesDir({ ensure: true }), 'global_expertise_index.yaml');

  console.log(`${'─'.repeat(60)}`);
  console.log('BUILDING INDEX...');
  console.log(`${'─'.repeat(60)}\n`);

  const start = Date.now();
  const index = await buildIndex(sessionsDir, outputPath);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(readFileSync(outputPath, 'utf8'));

  console.log(`${'─'.repeat(60)}`);
  console.log(`Sessions: ${index.session_count}`);
  console.log(`Domains:  ${index.domains?.length || 0}`);
  console.log(`Written:  ${outputPath}`);
  console.log(`Time:     ${elapsed}s`);
  console.log(`${'─'.repeat(60)}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

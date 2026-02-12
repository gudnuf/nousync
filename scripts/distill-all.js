#!/usr/bin/env node
// Usage: node scripts/distill-all.js [--project=nousphere] [--dry-run]
//
// Batch distills all transcripts (or filtered by project) and saves to ~/.nousphere/sessions/.
// Skips sessions that already have a distilled .md file.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import { distill } from '../packages/core/distiller.js';
import { sessionsDir, transcriptsGlob } from '../packages/core/paths.js';

// Load .env from project root
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

function sessionIdFromFilename(filename) {
  return basename(filename, '.jsonl');
}

function projectLabel(filePath) {
  const parts = filePath.split('/');
  const projectsIdx = parts.indexOf('projects');
  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
    return decodeURIComponent(parts[projectsIdx + 1]);
  }
  return basename(dirname(filePath));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const projectFlag = process.argv.find(a => a.startsWith('--project='));
  const projectFilter = projectFlag ? projectFlag.split('=')[1] : null;

  // Find all transcripts
  let files = globSync(transcriptsGlob())
    .map(f => ({
      path: f,
      sessionId: sessionIdFromFilename(f),
      project: projectLabel(f),
      size: readFileSync(f).length,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Filter by project if requested
  if (projectFilter) {
    files = files.filter(f => f.project.toLowerCase().includes(projectFilter.toLowerCase()));
  }

  // Check which are already distilled
  const outDir = sessionsDir({ ensure: true });
  const existing = new Set(
    readdirSync(outDir).filter(f => f.endsWith('.md')).map(f => basename(f, '.md'))
  );

  const todo = files.filter(f => !existing.has(f.sessionId));
  const skipped = files.filter(f => existing.has(f.sessionId));

  console.log(`\nFound ${files.length} transcripts${projectFilter ? ` matching "${projectFilter}"` : ''}`);
  console.log(`Already distilled: ${skipped.length}`);
  console.log(`To distill: ${todo.length}`);
  console.log(`Output dir: ${outDir}\n`);

  if (skipped.length > 0) {
    console.log('Skipping (already distilled):');
    skipped.forEach(f => console.log(`  ${f.sessionId} (${f.project})`));
    console.log();
  }

  if (todo.length === 0) {
    console.log('Nothing to distill.\n');
    return;
  }

  if (dryRun) {
    console.log('Would distill:');
    todo.forEach(f => {
      const kb = (f.size / 1024).toFixed(1);
      console.log(`  ${f.sessionId} (${f.project}, ${kb} KB)`);
    });
    console.log('\n--dry-run: skipping API calls.\n');
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY to continue.\n');
    process.exit(1);
  }

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < todo.length; i++) {
    const f = todo[i];
    const kb = (f.size / 1024).toFixed(1);
    console.log(`[${i + 1}/${todo.length}] Distilling ${f.sessionId} (${f.project}, ${kb} KB)...`);

    try {
      const start = Date.now();
      const result = await distill(f.path);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (result.validation.valid) {
        const outFile = join(outDir, `${result.sessionLog.frontmatter.session_id}.md`);
        writeFileSync(outFile, result.markdown);
        console.log(`  OK (${elapsed}s) → ${result.sessionLog.frontmatter.task}`);
        console.log(`  Tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);
        succeeded++;
      } else {
        console.log(`  VALIDATION FAILED (${elapsed}s):`);
        result.validation.errors.forEach(e => console.log(`    - ${e}`));
        failed++;
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      failed++;
    }
    console.log();
  }

  console.log(`${'─'.repeat(60)}`);
  console.log(`Done. ${succeeded} succeeded, ${failed} failed, ${skipped.length} skipped.`);
  console.log(`Sessions dir: ${outDir}`);
  console.log(`${'─'.repeat(60)}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

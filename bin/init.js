#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { globSync } from 'glob';
import yaml from 'js-yaml';
import { distill } from '../packages/core/distiller.js';
import { buildIndex } from '../packages/core/index-builder.js';
import {
  nousphereHome, sessionsDir, indexesDir, transcriptsGlob,
  configPath, loadConfig, ensureApiKey,
} from '../packages/core/paths.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`nousphere init - Set up nousphere

Usage:
  nousphere init                        # 20 most recent sessions
  nousphere init --project=myapp        # only sessions for "myapp"
  nousphere init --since=7d             # last 7 days
  nousphere init --since=90d            # last 90 days
  nousphere init --last=20              # 20 most recent sessions
  nousphere init --all                  # everything (can be a lot)

Options:
  --project=<name>   Only process sessions matching this project name
  --since=<duration> Only process sessions newer than this (e.g. 7d, 30d, 90d)
  --last=<n>         Only process the N most recent sessions
                     Default: last 20
  --all              Process all sessions (no recency filter)`);
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function prompt(question) {
  const answer = await rl.question(question);
  return answer.trim();
}

function step(n, msg) {
  console.log(`\n[${n}] ${msg}`);
}

function parseSince(flag) {
  if (!flag) return null;
  const match = flag.match(/^(\d+)d$/);
  if (!match) {
    console.error(`  Invalid --since value: ${flag} (use e.g. 7d, 30d, 90d)`);
    process.exit(1);
  }
  return parseInt(match[1]) * 24 * 60 * 60 * 1000;
}

function projectLabel(filePath) {
  const parts = filePath.split('/');
  const idx = parts.indexOf('projects');
  if (idx >= 0 && idx + 1 < parts.length) {
    return decodeURIComponent(parts[idx + 1]);
  }
  return basename(dirname(filePath));
}

async function main() {
  console.log('nousphere init');
  console.log('==============\n');
  console.log(`Data directory: ${nousphereHome()}`);

  // Parse flags
  const projectFlag = args.find(a => a.startsWith('--project='));
  const projectFilter = projectFlag ? projectFlag.split('=')[1] : null;

  const sinceFlag = args.find(a => a.startsWith('--since='));
  const lastFlag = args.find(a => a.startsWith('--last='));
  const allFlag = args.includes('--all');

  const sinceMs = sinceFlag ? parseSince(sinceFlag.split('=')[1]) : null;
  const cutoff = sinceMs ? Date.now() - sinceMs : null;
  // Default to last 20 unless --since, --all, or explicit --last
  const limit = allFlag || sinceFlag ? null : parseInt(lastFlag ? lastFlag.split('=')[1] : '20');

  // --- Step 1: API key ---
  step(1, 'Anthropic API key');

  ensureApiKey();

  if (process.env.ANTHROPIC_API_KEY) {
    const key = process.env.ANTHROPIC_API_KEY;
    console.log(`  Found: ${key.slice(0, 12)}...${key.slice(-4)}`);
  } else {
    console.log('  Nousphere uses the Anthropic API to distill your sessions.');
    console.log('  Your key will be saved to ~/.nousphere/config.yaml\n');

    const key = await prompt('  Anthropic API key: ');
    if (!key) {
      console.error('\n  API key is required.');
      process.exit(1);
    }

    mkdirSync(nousphereHome(), { recursive: true });
    const config = loadConfig();
    config.anthropic_api_key = key;
    writeFileSync(configPath(), yaml.dump(config));
    process.env.ANTHROPIC_API_KEY = key;

    console.log(`  Saved to ${configPath()}`);
  }

  // --- Step 2: Scan transcripts ---
  step(2, 'Scanning Claude Code transcripts');

  let files = globSync(transcriptsGlob())
    .map(f => {
      const st = statSync(f);
      return {
        path: f,
        sessionId: basename(f, '.jsonl'),
        project: projectLabel(f),
        size: st.size,
        mtime: st.mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const totalFound = files.length;

  // Apply recency filter
  if (cutoff) {
    files = files.filter(f => f.mtime >= cutoff);
  }

  // Apply project filter
  if (projectFilter) {
    files = files.filter(f => f.project.toLowerCase().includes(projectFilter.toLowerCase()));
  }

  // Apply count limit (files already sorted by mtime desc)
  if (limit) {
    files = files.slice(0, limit);
  }

  if (totalFound === 0) {
    console.log('  No transcripts found in ~/.claude/projects/');
    console.log('  Use Claude Code for a while, then run init again.');
    rl.close();
    return;
  }

  // Unique projects in the filtered set
  const projects = [...new Set(files.map(f => f.project))].sort();

  const filterDesc = [
    projectFilter ? `project "${projectFilter}"` : null,
    cutoff ? `since ${sinceFlag.split('=')[1]}` : null,
    limit ? `last ${limit}` : null,
  ].filter(Boolean).join(', ');

  console.log(`  ${totalFound} total transcripts found`);
  if (filterDesc) console.log(`  Filtered to ${files.length} (${filterDesc})`);
  console.log(`  Projects: ${projects.join(', ')}`);

  const outDir = sessionsDir({ ensure: true });
  const existing = new Set(
    existsSync(outDir)
      ? readdirSync(outDir).filter(f => f.endsWith('.md')).map(f => basename(f, '.md'))
      : []
  );

  const todo = files.filter(f => !existing.has(f.sessionId));

  console.log(`  ${existing.size} already distilled`);
  console.log(`  ${todo.length} new sessions to process`);

  // --- Step 3: Distill ---
  if (todo.length > 0) {
    step(3, `Distilling ${todo.length} sessions`);

    const estMinutes = Math.ceil(todo.length * 0.5);
    console.log(`  ~${estMinutes} min, calls the Anthropic API (~30s each)\n`);

    const answer = await prompt(`  Proceed? [Y/n] `);
    if (answer && answer.toLowerCase() !== 'y') {
      console.log('  Skipped.');
      rl.close();
      return;
    }
    console.log();

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < todo.length; i++) {
      const f = todo[i];
      const kb = (f.size / 1024).toFixed(0);
      process.stdout.write(`  [${i + 1}/${todo.length}] ${f.project} (${kb} KB)... `);

      try {
        const result = await distill(f.path);
        if (result.validation.valid) {
          const outFile = join(outDir, `${result.sessionLog.frontmatter.session_id}.md`);
          writeFileSync(outFile, result.markdown);
          console.log(result.sessionLog.frontmatter.task);
          succeeded++;
        } else {
          console.log('validation failed');
          failed++;
        }
      } catch (err) {
        console.log(`error: ${err.message}`);
        failed++;
      }
    }

    console.log(`\n  ${succeeded} succeeded, ${failed} failed`);
  } else {
    step(3, 'Distillation');
    console.log('  All sessions already distilled.');
  }

  // --- Step 4: Build index ---
  const totalSessions = readdirSync(outDir).filter(f => f.endsWith('.md')).length;

  if (totalSessions > 0) {
    step(4, `Building expertise index from ${totalSessions} sessions`);

    const outPath = join(indexesDir({ ensure: true }), 'global_expertise_index.yaml');
    const index = await buildIndex(outDir, outPath);

    console.log(`  ${index.domains?.length || 0} expertise domains identified`);
    console.log(`  Saved to ${outPath}`);
  }

  // --- Done ---
  console.log('\n==============');
  console.log('Ready! Start sharing:\n');
  console.log('  npx nousphere serve\n');

  rl.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

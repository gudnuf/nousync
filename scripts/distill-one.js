#!/usr/bin/env node
// Usage: node scripts/distill-one.js [path-to-transcript.jsonl] [--save]
//
// Two-step walkthrough:
//   Step 1: Parse transcript → show condensed messages + metadata
//   Step 2: Press enter → distill via Claude API → show session log
//
// --save: Write the distilled session log to ~/.nousync/sessions/<session_id>.md
// If no path given, lists available transcripts from all Claude Code projects.

import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import { parseTranscript } from '../packages/core/transcript-parser.js';
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

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function projectLabel(filePath) {
  // Extract project folder name from ~/.claude/projects/<encoded-path>/file.jsonl
  const parts = filePath.split('/');
  const projectsIdx = parts.indexOf('projects');
  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
    return parts[projectsIdx + 1];
  }
  return basename(dirname(filePath));
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const save = process.argv.includes('--save');
  let transcriptPath = args[0];

  if (!transcriptPath) {
    const files = globSync(transcriptsGlob())
      .map(f => {
        const s = statSync(f);
        return { name: basename(f), path: f, size: s.size, mtime: s.mtime, project: projectLabel(f) };
      })
      .sort((a, b) => b.mtime - a.mtime); // most recent first

    if (files.length === 0) {
      console.error('No transcripts found in ~/.claude/projects/');
      process.exit(1);
    }

    console.log('\nAvailable transcripts:\n');
    files.forEach((f, i) => {
      const kb = (f.size / 1024).toFixed(1);
      const age = timeSince(f.mtime);
      console.log(`  ${String(i + 1).padStart(3)}) ${f.project}  ${f.name}  (${kb} KB, ${age})`);
    });

    const choice = await prompt('\nPick a number (or q to quit): ');
    if (choice === 'q') return;
    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= files.length) {
      console.error('Invalid choice.');
      process.exit(1);
    }
    transcriptPath = files[idx].path;
  }

  // ── Step 1: Parse ──────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`STEP 1: PARSE TRANSCRIPT`);
  console.log(`${'─'.repeat(60)}\n`);
  console.log(`File: ${transcriptPath}\n`);

  const { messages, metadata } = parseTranscript(transcriptPath);

  console.log('Metadata:');
  console.log(`  Session ID:    ${metadata.sessionId}`);
  console.log(`  Project:       ${metadata.project}`);
  console.log(`  Duration:      ${metadata.durationMinutes} min`);
  console.log(`  Agent:         ${metadata.agentName} ${metadata.agentVersion || ''}`);
  console.log(`  Model:         ${metadata.model || 'unknown'}`);
  console.log(`  Tools used:    ${metadata.toolsUsed.join(', ') || 'none'}`);
  console.log(`  Files touched: ${metadata.filesTouched.length}`);
  console.log(`  CWD:           ${metadata.cwd}`);
  console.log(`  Git branch:    ${metadata.gitBranch}`);
  console.log(`  Git commit:    ${metadata.gitCommit || 'none found'}`);
  console.log(`  Git remote:    ${metadata.gitRemote || 'none found'}`);
  console.log(`  First msg:     ${metadata.timestamps.first}`);
  console.log(`  Last msg:      ${metadata.timestamps.last}`);
  console.log(`  Messages:      ${messages.length} (after filtering + grouping)`);

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  console.log(`  Total chars:   ${totalChars.toLocaleString()}`);

  console.log(`\n${'─'.repeat(60)}`);
  console.log('CONDENSED CONVERSATION');
  console.log(`${'─'.repeat(60)}\n`);

  for (const msg of messages) {
    const label = msg.role === 'user' ? '\x1b[36mUSER\x1b[0m' : '\x1b[33mASSISTANT\x1b[0m';
    const preview = msg.content.length > 500
      ? msg.content.slice(0, 500) + `\n  ... (${msg.content.length} chars total)`
      : msg.content;
    console.log(`[${label}]`);
    console.log(`  ${preview.split('\n').join('\n  ')}`);
    console.log();
  }

  // ── Step 2: Distill ────────────────────────────────────────
  const answer = await prompt('Press ENTER to distill via Claude API (or q to quit): ');
  if (answer === 'q') return;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nSet ANTHROPIC_API_KEY to continue.\n');
    process.exit(1);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`STEP 2: DISTILL`);
  console.log(`${'─'.repeat(60)}\n`);

  const start = Date.now();
  const result = await distill(transcriptPath);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(result.markdown);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Validation: ${result.validation.valid ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`);
  if (!result.validation.valid) {
    result.validation.errors.forEach(e => console.log(`  - ${e}`));
    console.log(`\n${'─'.repeat(60)}`);
    console.log('TOOL INPUT (JSON from model):');
    console.log(`${'─'.repeat(60)}`);
    console.log(JSON.stringify(result.toolInput, null, 2).slice(0, 3000));
    console.log(`${'─'.repeat(60)}`);
  }
  console.log(`Tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);
  console.log(`Time: ${elapsed}s`);
  console.log(`${'─'.repeat(60)}\n`);

  if (save && result.validation.valid) {
    const outDir = sessionsDir({ ensure: true });
    const outFile = join(outDir, `${result.sessionLog.frontmatter.session_id}.md`);
    writeFileSync(outFile, result.markdown);
    console.log(`Saved: ${outFile}\n`);
  } else if (save && !result.validation.valid) {
    console.log('Skipped save: validation failed.\n');
  }
}

function timeSince(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

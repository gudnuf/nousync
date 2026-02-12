import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import { distill } from '../packages/core/distiller.js';
import { claudeProjectsDir } from '../packages/core/paths.js';

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe('integration: distill real transcript', { skip: !hasApiKey && 'ANTHROPIC_API_KEY not set' }, () => {
  let transcriptPath;

  before(() => {
    const projectsDir = claudeProjectsDir();
    if (!existsSync(projectsDir)) {
      throw new Error(`Claude projects directory not found: ${projectsDir}`);
    }

    // Find transcripts across all projects
    const files = globSync(join(projectsDir, '*', '*.jsonl'))
      .map(f => ({
        name: f.split('/').pop(),
        path: f,
      }));

    if (files.length === 0) {
      throw new Error('No transcript files found');
    }

    // Pick the smallest one for faster testing
    const stats = files.map(f => ({
      ...f,
      size: statSync(f.path).size,
    }));
    stats.sort((a, b) => a.size - b.size);
    transcriptPath = stats[0].path;
  });

  it('distills a real transcript into a valid session log', async () => {
    const result = await distill(transcriptPath);

    // Should produce structured output
    assert.ok(result.sessionLog, 'should have sessionLog');
    assert.ok(result.markdown, 'should have markdown output');
    assert.ok(result.metadata, 'should have metadata');
    assert.ok(result.usage, 'should have API usage');

    // Frontmatter should be populated
    const fm = result.sessionLog.frontmatter;
    assert.ok(fm.session_id, 'should have session_id');
    assert.ok(fm.task, 'should have task');
    assert.ok(fm.outcome, 'should have outcome');
    assert.ok(fm.tags?.length > 0, 'should have tags');
    assert.ok(fm.key_insight, 'should have key_insight');

    // Validation should pass (or at least be close)
    if (!result.validation.valid) {
      console.log('Validation errors:', result.validation.errors);
    }

    // Log output for manual review
    console.log('\n--- Distilled Output ---');
    console.log(`Task: ${fm.task}`);
    console.log(`Outcome: ${fm.outcome}`);
    console.log(`Tags: ${fm.tags?.join(', ')}`);
    console.log(`Key insight: ${fm.key_insight}`);
    console.log(`Confidence: ${fm.confidence}`);
    console.log(`Tokens: ${result.usage.input_tokens}in / ${result.usage.output_tokens}out`);
    console.log('------------------------\n');
  }, { timeout: 60_000 });
});

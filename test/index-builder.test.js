import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { buildIndex } from '../packages/core/index-builder.js';
import { serialize } from '../packages/core/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTmpDir() {
  const dir = join(__dirname, 'fixtures', `_tmp_index_${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSessionLog(dir, filename, frontmatter, sections) {
  const md = serialize({
    frontmatter,
    sections: sections || {
      'What Was Built': 'Built something.',
      'What Failed First': 'Failed at something.',
      'What Worked': 'Worked with something.',
      'Gotchas': 'Watch out for something.',
      'Code Patterns': 'Use something.',
    },
  });
  writeFileSync(join(dir, filename), md);
}

describe('buildIndex', () => {
  it('returns empty index for empty directory', async () => {
    const dir = createTmpDir();
    try {
      const index = await buildIndex(dir, null, {});
      assert.deepEqual(index.domains, []);
      assert.equal(index.session_count, 0);
      assert.ok(index.generated_at);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('handles single session without API call', async () => {
    const dir = createTmpDir();
    try {
      writeSessionLog(dir, 'session1.md', {
        session_id: 's1', timestamp: '2026-01-01', project: 'test', task: 'Build a widget',
        outcome: 'success', tags: ['widget'], stack: ['node'],
        duration_minutes: 10, key_insight: 'Widgets are easy', confidence: 'high',
      });

      const index = await buildIndex(dir, null, {});
      assert.equal(index.session_count, 1);
      assert.equal(index.domains.length, 1);
      assert.equal(index.domains[0].name, 'General');
      assert.deepEqual(index.domains[0].sessions, ['s1']);
      assert.deepEqual(index.domains[0].tags, ['widget']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('calls Claude API for 2+ sessions and writes YAML', async () => {
    const dir = createTmpDir();
    const outputPath = join(dir, 'expertise_index.yaml');

    const mockClient = {
      messages: {
        create: async () => ({
          content: [{
            type: 'tool_use',
            id: 'toolu_mock',
            name: 'save_expertise_index',
            input: {
              domains: [{
                name: 'Web Development',
                summary: 'Building web servers and APIs',
                depth: 'working',
                tags: ['express', 'api'],
                sessions: ['s1', 's2'],
                key_insights: ['Express is fast', 'APIs need validation'],
              }],
            },
          }],
          usage: { input_tokens: 50, output_tokens: 100 },
        }),
      },
    };

    try {
      writeSessionLog(dir, 'session1.md', {
        session_id: 's1', timestamp: '2026-01-01', project: 'test', task: 'Build Express API',
        outcome: 'success', tags: ['express'], stack: ['node'],
        duration_minutes: 30, key_insight: 'Express is fast', confidence: 'high',
      });
      writeSessionLog(dir, 'session2.md', {
        session_id: 's2', timestamp: '2026-01-02', project: 'test', task: 'Add API validation',
        outcome: 'success', tags: ['api'], stack: ['node'],
        duration_minutes: 20, key_insight: 'APIs need validation', confidence: 'medium',
      });

      const index = await buildIndex(dir, outputPath, { client: mockClient });

      assert.equal(index.session_count, 2);
      assert.ok(index.domains.length > 0);
      assert.equal(index.domains[0].name, 'Web Development');

      // Verify YAML file was written
      const yamlContent = readFileSync(outputPath, 'utf8');
      const parsed = yaml.load(yamlContent);
      assert.equal(parsed.session_count, 2);
      assert.ok(parsed.domains.length > 0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('does not crash on files with no frontmatter', async () => {
    const dir = createTmpDir();
    const mockClient = {
      messages: {
        create: async () => ({
          content: [{
            type: 'tool_use',
            id: 'toolu_mock',
            name: 'save_expertise_index',
            input: {
              domains: [{
                name: 'General',
                summary: 'Mixed',
                depth: 'surface',
                tags: ['test'],
                sessions: ['s1'],
                key_insights: ['It works'],
              }],
            },
          }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      },
    };
    try {
      writeSessionLog(dir, 'good.md', {
        session_id: 's1', timestamp: '2026-01-01', project: 'test', task: 'Good session',
        outcome: 'success', tags: ['test'], stack: ['node'],
        duration_minutes: 5, key_insight: 'It works', confidence: 'high',
      });
      // gray-matter is lenient - this will parse but have empty frontmatter
      writeFileSync(join(dir, 'bad.md'), 'No frontmatter here, just text.');

      // Should not throw, regardless of how many sessions are counted
      const index = await buildIndex(dir, null, { client: mockClient });
      assert.ok(index.session_count >= 1, 'should count at least the good session');
      assert.ok(index.generated_at, 'should have timestamp');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

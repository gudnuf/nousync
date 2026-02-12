import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, validate, serialize } from '../packages/core/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

describe('schema.parse', () => {
  it('parses valid session log frontmatter', () => {
    const content = readFileSync(join(FIXTURES, 'sample-session-log.md'), 'utf8');
    const result = parse(content);
    assert.equal(result.frontmatter.session_id, 'test-session-001');
    assert.equal(result.frontmatter.project, 'project');
    assert.equal(result.frontmatter.outcome, 'success');
    assert.equal(result.frontmatter.confidence, 'high');
    assert.deepEqual(result.frontmatter.tags, ['express-server', 'health-endpoint', 'node-setup']);
    assert.deepEqual(result.frontmatter.stack, ['node', 'express']);
    assert.deepEqual(result.frontmatter.tools_used, ['Write', 'Bash']);
    assert.deepEqual(result.frontmatter.files_touched, ['/Users/test/project/server.js']);
    assert.equal(result.frontmatter.duration_minutes, 0);
    assert.equal(result.frontmatter.agent_name, 'claude-code');
    assert.equal(result.frontmatter.model, 'claude-sonnet-4-5-20250929');
    assert.equal(result.frontmatter.git_branch, 'main');
  });

  it('parses body sections', () => {
    const content = readFileSync(join(FIXTURES, 'sample-session-log.md'), 'utf8');
    const result = parse(content);
    assert.ok(result.sections['What Was Built'], 'should have What Was Built');
    assert.ok(result.sections['What Failed First'], 'should have What Failed First');
    assert.ok(result.sections['What Worked'], 'should have What Worked');
    assert.ok(result.sections['Gotchas'], 'should have Gotchas');
    assert.ok(result.sections['Code Patterns'], 'should have Code Patterns');
  });

  it('parses invalid session log without crashing', () => {
    const content = readFileSync(join(FIXTURES, 'sample-session-log-invalid.md'), 'utf8');
    const result = parse(content);
    assert.equal(result.frontmatter.session_id, 'test-session-bad');
    assert.equal(result.frontmatter.outcome, 'unknown');
  });
});

describe('schema.validate', () => {
  it('validates a correct session log', () => {
    const content = readFileSync(join(FIXTURES, 'sample-session-log.md'), 'utf8');
    const sessionLog = parse(content);
    const { valid, errors } = validate(sessionLog);
    assert.equal(valid, true, `Expected valid but got errors: ${errors.join(', ')}`);
    assert.equal(errors.length, 0);
  });

  it('collects errors for invalid session log', () => {
    const content = readFileSync(join(FIXTURES, 'sample-session-log-invalid.md'), 'utf8');
    const sessionLog = parse(content);
    const { valid, errors } = validate(sessionLog);
    assert.equal(valid, false);
    assert.ok(errors.length > 0, 'should have errors');
    assert.ok(errors.some(e => e.includes('timestamp')), 'should flag missing timestamp');
    assert.ok(errors.some(e => e.includes('project')), 'should flag missing project');
    assert.ok(errors.some(e => e.includes('task')), 'should flag missing task');
    assert.ok(errors.some(e => e.includes('outcome')), 'should flag invalid outcome');
    assert.ok(errors.some(e => e.includes('tags must be an array')), 'should flag non-array tags');
    assert.ok(errors.some(e => e.includes('duration_minutes must be a number')), 'should flag string duration');
    assert.ok(errors.some(e => e.includes('key_insight')), 'should flag missing key_insight');
    assert.ok(errors.some(e => e.includes('confidence')), 'should flag missing confidence');
  });

  it('flags missing sections', () => {
    const content = readFileSync(join(FIXTURES, 'sample-session-log-invalid.md'), 'utf8');
    const sessionLog = parse(content);
    const { errors } = validate(sessionLog);
    assert.ok(errors.some(e => e.includes('What Failed First')), 'should flag missing section');
    assert.ok(errors.some(e => e.includes('Gotchas')), 'should flag missing Gotchas');
    assert.ok(errors.some(e => e.includes('Code Patterns')), 'should flag missing Code Patterns');
  });

  it('accepts all valid enum values', () => {
    for (const outcome of ['success', 'partial', 'failed', 'exploratory', 'undistilled']) {
      for (const confidence of ['high', 'medium', 'low']) {
        const sessionLog = {
          frontmatter: {
            session_id: 'test', timestamp: '2026-01-01', project: 'test-project', task: 'test task',
            outcome, tags: ['a'], duration_minutes: 5, key_insight: 'insight', confidence,
          },
          sections: {
            'What Was Built': 'x', 'What Failed First': 'x', 'What Worked': 'x',
            'Gotchas': 'x', 'Code Patterns': 'x',
          },
        };
        const { valid, errors } = validate(sessionLog);
        assert.equal(valid, true, `${outcome}/${confidence} should be valid but got: ${errors.join(', ')}`);
      }
    }
  });
});

describe('schema.serialize', () => {
  it('round-trips parse → serialize → parse', () => {
    const original = readFileSync(join(FIXTURES, 'sample-session-log.md'), 'utf8');
    const parsed1 = parse(original);
    const serialized = serialize(parsed1);
    const parsed2 = parse(serialized);

    assert.deepEqual(parsed2.frontmatter, parsed1.frontmatter);
    // Sections should have same content (whitespace may differ)
    for (const key of Object.keys(parsed1.sections)) {
      assert.ok(parsed2.sections[key], `section ${key} should exist after round-trip`);
      assert.equal(
        parsed2.sections[key].trim(),
        parsed1.sections[key].trim(),
        `section ${key} content should match`,
      );
    }
  });

  it('produces valid markdown with frontmatter', () => {
    const sessionLog = {
      frontmatter: {
        session_id: 'round-trip-test',
        timestamp: '2026-01-01T00:00:00Z',
        project: 'test-project',
        task: 'Test round-trip',
        outcome: 'success',
        tags: ['test'],
        stack: ['node'],
        tools_used: ['Bash'],
        duration_minutes: 1,
        key_insight: 'Tests work',
        confidence: 'high',
      },
      sections: {
        'What Was Built': 'A test.',
        'What Failed First': 'Nothing.',
        'What Worked': 'Everything.',
        'Gotchas': 'None.',
        'Code Patterns': 'assert.ok(true)',
      },
    };

    const md = serialize(sessionLog);
    assert.ok(md.startsWith('---'), 'should start with frontmatter delimiter');
    assert.ok(md.includes('session_id: round-trip-test'), 'should have session_id');
    assert.ok(md.includes('## What Was Built'), 'should have section headers');
    assert.ok(md.includes('## Gotchas'), 'should have Gotchas section');
  });
});

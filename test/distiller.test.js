import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distill } from '../packages/core/distiller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

const VALID_TOOL_INPUT = {
  session_id: 'test-session-001',
  timestamp: '2026-01-15T10:00:01.000Z',
  project: 'project',
  task: 'Set up Express server with health endpoint',
  outcome: 'success',
  tags: ['express-server', 'health-endpoint'],
  stack: ['node', 'express'],
  tools_used: ['Write', 'Bash'],
  files_touched: ['/Users/test/project/server.js'],
  duration_minutes: 0,
  key_insight: 'Express 5 health endpoints are trivial - just a GET route returning JSON',
  confidence: 'high',
  agent_name: 'claude-code',
  agent_version: '2.1.38',
  model: 'claude-sonnet-4-5-20250929',
  git_branch: 'main',
  git_commit: null,
  git_remote: null,
  what_was_built: 'A minimal Express server with a /health endpoint that returns JSON status.',
  what_failed_first: 'No significant failures. The straightforward approach worked on the first try.',
  what_worked: 'Using Express 5 with ESM imports and a simple GET route for health checking. Verified with curl.',
  gotchas: 'Express 5 requires Node 18+ for native ESM support.',
  code_patterns: "Health check pattern: `app.get('/health', (req, res) => res.json({ status: 'ok' }))`",
};

function createMockClient(toolInput) {
  return {
    messages: {
      create: async () => ({
        content: [{
          type: 'tool_use',
          id: 'toolu_mock',
          name: 'save_session_log',
          input: toolInput,
        }],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    },
  };
}

describe('distiller', () => {
  it('distills a transcript using mock client', async () => {
    const result = await distill(join(FIXTURES, 'sample-transcript-short.jsonl'), {
      client: createMockClient(VALID_TOOL_INPUT),
    });

    assert.ok(result.sessionLog, 'should have sessionLog');
    assert.ok(result.markdown, 'should have markdown');
    assert.ok(result.validation, 'should have validation');
    assert.ok(result.metadata, 'should have metadata');
    assert.ok(result.usage, 'should have usage');
    assert.ok(result.toolInput, 'should have toolInput');

    assert.equal(result.sessionLog.frontmatter.session_id, 'test-session-001');
    assert.equal(result.sessionLog.frontmatter.outcome, 'success');
    assert.equal(result.sessionLog.frontmatter.project, 'project');
    assert.equal(result.validation.valid, true, `Validation errors: ${result.validation.errors.join(', ')}`);
  });

  it('produces valid markdown from tool output', async () => {
    const result = await distill(join(FIXTURES, 'sample-transcript-short.jsonl'), {
      client: createMockClient(VALID_TOOL_INPUT),
    });

    assert.ok(result.markdown.includes('---'), 'should have frontmatter');
    assert.ok(result.markdown.includes('## What Was Built'), 'should have sections');
    assert.ok(result.markdown.includes('Express 5 health endpoints'), 'should have key_insight');
  });

  it('returns validation errors for incomplete tool output', async () => {
    const badInput = {
      session_id: 'test',
      timestamp: '2026-01-01',
      project: 'test',
      task: 'Test',
      outcome: 'success',
      tags: ['test'],
      stack: [],
      tools_used: [],
      duration_minutes: 1,
      key_insight: 'insight',
      confidence: 'high',
      what_was_built: 'Something.',
      what_failed_first: '', // empty — should fail validation
      what_worked: 'It worked.',
      gotchas: '', // empty — should fail validation
      code_patterns: 'A pattern.',
    };

    const result = await distill(join(FIXTURES, 'sample-transcript-short.jsonl'), {
      client: createMockClient(badInput),
    });

    assert.equal(result.validation.valid, false);
    assert.ok(result.validation.errors.some(e => e.includes('What Failed First')));
    assert.ok(result.validation.errors.some(e => e.includes('Gotchas')));
  });

  it('throws on empty transcript', async () => {
    await assert.rejects(
      () => distill(join(FIXTURES, 'sample-transcript-empty.jsonl'), {
        client: createMockClient(VALID_TOOL_INPUT),
      }),
      { message: /no conversation messages/ },
    );
  });

  it('throws when model does not call tool', async () => {
    const noToolClient = {
      messages: {
        create: async () => ({
          content: [{ type: 'text', text: 'I cannot do this.' }],
          usage: { input_tokens: 50, output_tokens: 10 },
        }),
      },
    };

    await assert.rejects(
      () => distill(join(FIXTURES, 'sample-transcript-short.jsonl'), { client: noToolClient }),
      { message: /did not call save_session_log/ },
    );
  });

  it('passes transcript metadata to distill output', async () => {
    const result = await distill(join(FIXTURES, 'sample-transcript-short.jsonl'), {
      client: createMockClient(VALID_TOOL_INPUT),
    });

    assert.equal(result.metadata.sessionId, 'test-session-001');
    assert.equal(result.metadata.cwd, '/Users/test/project');
    assert.equal(result.metadata.project, 'project');
    assert.ok(result.metadata.toolsUsed.includes('Write'));
    assert.ok(result.metadata.toolsUsed.includes('Bash'));
  });

  it('reports API usage', async () => {
    const result = await distill(join(FIXTURES, 'sample-transcript-short.jsonl'), {
      client: createMockClient(VALID_TOOL_INPUT),
    });

    assert.equal(result.usage.input_tokens, 100);
    assert.equal(result.usage.output_tokens, 200);
  });

  it('propagates API errors', async () => {
    const failClient = {
      messages: {
        create: async () => { throw new Error('API rate limit'); },
      },
    };

    await assert.rejects(
      () => distill(join(FIXTURES, 'sample-transcript-short.jsonl'), { client: failClient }),
      { message: /API rate limit/ },
    );
  });

  it('falls back to metadata for missing agent fields', async () => {
    const minimalInput = {
      ...VALID_TOOL_INPUT,
      agent_name: undefined,
      agent_version: undefined,
      model: undefined,
      git_branch: undefined,
    };

    const result = await distill(join(FIXTURES, 'sample-transcript-short.jsonl'), {
      client: createMockClient(minimalInput),
    });

    // Should fall back to parser metadata
    assert.equal(result.sessionLog.frontmatter.agent_name, 'claude-code');
    assert.equal(result.sessionLog.frontmatter.agent_version, '2.1.38');
    assert.equal(result.sessionLog.frontmatter.model, 'claude-sonnet-4-5-20250929');
    assert.equal(result.sessionLog.frontmatter.git_branch, 'main');
  });
});

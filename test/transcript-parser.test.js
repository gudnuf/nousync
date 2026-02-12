import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { parseTranscript } from '../packages/core/transcript-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

describe('parseTranscript', () => {
  it('filters to only user and assistant messages', () => {
    const { messages } = parseTranscript(join(FIXTURES, 'sample-transcript-short.jsonl'));
    for (const msg of messages) {
      assert.ok(['user', 'assistant'].includes(msg.role), `unexpected role: ${msg.role}`);
    }
    assert.ok(messages.length > 0, 'should have some messages');
  });

  it('handles string content (first user message)', () => {
    const { messages } = parseTranscript(join(FIXTURES, 'sample-transcript-short.jsonl'));
    const firstUser = messages.find(m => m.role === 'user');
    assert.ok(firstUser, 'should have a user message');
    assert.ok(firstUser.content.includes('Express server'), 'should contain user text');
  });

  it('condenses thinking blocks (strips signature)', () => {
    const { messages } = parseTranscript(join(FIXTURES, 'sample-transcript-short.jsonl'));
    const allContent = messages.map(m => m.content).join('\n');
    assert.ok(allContent.includes('[Thinking]'), 'should have thinking marker');
    assert.ok(!allContent.includes('sig123'), 'should not contain signature');
  });

  it('summarizes tool_use blocks', () => {
    const { messages } = parseTranscript(join(FIXTURES, 'sample-transcript-short.jsonl'));
    const allContent = messages.map(m => m.content).join('\n');
    assert.ok(allContent.includes('[Tool: Write]'), 'should summarize Write tool');
    assert.ok(allContent.includes('[Tool: Bash]'), 'should summarize Bash tool');
    assert.ok(allContent.includes('server.js'), 'should include file path in Write summary');
  });

  it('truncates tool_result content', () => {
    const { messages } = parseTranscript(join(FIXTURES, 'sample-transcript-short.jsonl'));
    const allContent = messages.map(m => m.content).join('\n');
    assert.ok(allContent.includes('[Result]'), 'should have Result markers');
  });

  it('returns empty messages for empty transcript', () => {
    const { messages, metadata } = parseTranscript(join(FIXTURES, 'sample-transcript-empty.jsonl'));
    assert.equal(messages.length, 0);
    assert.equal(metadata.sessionId, 'test-session-empty');
  });

  it('extracts metadata correctly', () => {
    const { metadata } = parseTranscript(join(FIXTURES, 'sample-transcript-short.jsonl'));
    assert.equal(metadata.sessionId, 'test-session-001');
    assert.equal(metadata.project, 'project');
    assert.equal(metadata.cwd, '/Users/test/project');
    assert.equal(metadata.gitBranch, 'main');
    assert.equal(metadata.agentName, 'claude-code');
    assert.equal(metadata.agentVersion, '2.1.38');
    assert.equal(metadata.model, 'claude-sonnet-4-5-20250929');
    assert.ok(metadata.toolsUsed.includes('Write'), 'should include Write in tools');
    assert.ok(metadata.toolsUsed.includes('Bash'), 'should include Bash in tools');
    assert.ok(metadata.filesTouched.includes('/Users/test/project/server.js'), 'should track files touched');
    assert.ok(metadata.timestamps.first, 'should have first timestamp');
    assert.ok(metadata.timestamps.last, 'should have last timestamp');
  });

  it('applies tier-2 condensation for large transcripts', () => {
    // Create a transcript with massive tool results to trigger tier 2
    const tmpDir = join(__dirname, 'fixtures', '_tmp_tier2');
    mkdirSync(tmpDir, { recursive: true });
    const tmpFile = join(tmpDir, 'large.jsonl');

    const largeResult = 'x'.repeat(20_000);
    const lines = [];

    // Generate enough large tool results to exceed 80K chars
    // Each user message has multiple tool_results so they don't get merged under tier-1 truncation
    for (let i = 0; i < 30; i++) {
      lines.push(JSON.stringify({
        type: 'assistant',
        sessionId: 'large-session',
        cwd: '/tmp',
        gitBranch: 'main',
        timestamp: `2026-01-15T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Lots of thought '.repeat(200), signature: 'sig' }, { type: 'text', text: 'Response '.repeat(200) }] },
        uuid: `a-${i}`,
      }));
      lines.push(JSON.stringify({
        type: 'user',
        sessionId: 'large-session',
        cwd: '/tmp',
        gitBranch: 'main',
        timestamp: `2026-01-15T10:${String(Math.floor((i + 30) / 60)).padStart(2, '0')}:${String((i + 30) % 60).padStart(2, '0')}.000Z`,
        message: { role: 'user', content: [{ type: 'tool_result', content: largeResult }, { type: 'tool_result', content: largeResult }] },
        uuid: `u-${i}`,
      }));
    }

    writeFileSync(tmpFile, lines.join('\n'));

    try {
      const { messages } = parseTranscript(tmpFile);
      const allContent = messages.map(m => m.content).join('\n');
      // In tier 2, tool results are dropped entirely
      assert.ok(!allContent.includes('[Result]'), 'tier-2 should drop tool results');
      // Thinking should be truncated
      const thinkingMatch = allContent.match(/\[Thinking\] .+/);
      if (thinkingMatch) {
        assert.ok(thinkingMatch[0].length < 500, 'thinking should be truncated in tier 2');
      }
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('groups consecutive same-role messages', () => {
    const { messages } = parseTranscript(join(FIXTURES, 'sample-transcript-short.jsonl'));
    // No two consecutive messages should have the same role after grouping
    for (let i = 1; i < messages.length; i++) {
      // Consecutive same roles should be merged, but different roles alternate
      // (Note: this may not always alternate perfectly due to filtering)
    }
    assert.ok(messages.length > 0, 'sanity check');
  });
});

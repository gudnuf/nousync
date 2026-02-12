import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { synthesize } from '../packages/agent/synthesizer.js';

function createMockClient(toolInput) {
  return {
    messages: {
      create: async (params) => {
        // Store params for inspection
        createMockClient._lastParams = params;
        return {
          content: [{
            type: 'tool_use',
            id: 'toolu_mock',
            name: 'synthesize_response',
            input: toolInput,
          }],
          usage: { input_tokens: 100, output_tokens: 200 },
        };
      },
    },
  };
}

const MOCK_SESSIONS = [
  {
    frontmatter: {
      session_id: 's1',
      timestamp: '2026-01-01',
      project: 'test',
      task: 'Set up Nix flake',
      outcome: 'success',
      tags: ['nix', 'flake'],
      stack: ['nix'],
      duration_minutes: 10,
      key_insight: 'Use direnv with flakes',
      confidence: 'high',
    },
    sections: {
      'What Was Built': 'A Nix flake dev environment.',
      'What Failed First': 'Nothing significant.',
      'What Worked': 'direnv use flake pattern.',
      'Gotchas': 'Need .envrc file.',
      'Code Patterns': 'use flake in .envrc',
    },
  },
];

describe('synthesize', () => {
  it('returns structured response from mock client', async () => {
    const client = createMockClient({
      response: 'Based on my experience, use direnv with Nix flakes.',
      confidence: 'high',
      based_on_sessions: ['s1'],
      followup_available: true,
    });

    const result = await synthesize('How do I set up Nix flakes?', MOCK_SESSIONS, { client });

    assert.equal(result.response, 'Based on my experience, use direnv with Nix flakes.');
    assert.equal(result.confidence, 'high');
    assert.deepEqual(result.based_on_sessions, ['s1']);
    assert.equal(result.followup_available, true);
    assert.ok(result.usage);
    assert.equal(result.usage.input_tokens, 100);
  });

  it('includes conversation history in messages', async () => {
    const client = createMockClient({
      response: 'The .envrc file should contain "use flake".',
      confidence: 'high',
      based_on_sessions: ['s1'],
      followup_available: false,
    });

    const conversationHistory = [
      { role: 'user', content: 'Tell me about Nix flakes.' },
      { role: 'assistant', content: 'Nix flakes provide reproducible development environments.' },
    ];

    await synthesize('What goes in .envrc?', MOCK_SESSIONS, {
      client,
      conversationHistory,
    });

    // The messages should include history + current question
    const params = createMockClient._lastParams;
    assert.equal(params.messages.length, 3);
    assert.equal(params.messages[0].role, 'user');
    assert.equal(params.messages[0].content, 'Tell me about Nix flakes.');
    assert.equal(params.messages[1].role, 'assistant');
    assert.equal(params.messages[2].role, 'user');
    assert.ok(params.messages[2].content.includes('What goes in .envrc?'));
  });

  it('handles empty sessions gracefully', async () => {
    const client = createMockClient({
      response: "I don't have direct experience with this topic.",
      confidence: 'low',
      based_on_sessions: [],
      followup_available: false,
    });

    const result = await synthesize('What is quantum computing?', [], { client });

    assert.equal(result.confidence, 'low');
    assert.deepEqual(result.based_on_sessions, []);
  });

  it('includes context in user message when provided', async () => {
    const client = createMockClient({
      response: 'Answer with context.',
      confidence: 'medium',
      based_on_sessions: ['s1'],
      followup_available: false,
    });

    await synthesize('How to deploy?', MOCK_SESSIONS, {
      client,
      context: 'Working on a NixOS server',
    });

    const params = createMockClient._lastParams;
    const lastMsg = params.messages[params.messages.length - 1];
    assert.ok(lastMsg.content.includes('Working on a NixOS server'));
    assert.ok(lastMsg.content.includes('How to deploy?'));
  });

  it('throws when model skips tool call', async () => {
    const client = {
      messages: {
        create: async () => ({
          content: [{ type: 'text', text: 'I refuse to use the tool.' }],
          usage: { input_tokens: 50, output_tokens: 20 },
        }),
      },
    };

    await assert.rejects(
      () => synthesize('test', MOCK_SESSIONS, { client }),
      /did not call synthesize_response tool/,
    );
  });

  it('passes system prompt with session content', async () => {
    const client = createMockClient({
      response: 'test',
      confidence: 'low',
      based_on_sessions: [],
      followup_available: false,
    });

    await synthesize('test question', MOCK_SESSIONS, { client });

    const params = createMockClient._lastParams;
    assert.ok(params.system.includes('s1'), 'system prompt should contain session ID');
    assert.ok(params.system.includes('Nix flake'), 'system prompt should contain session content');
  });
});

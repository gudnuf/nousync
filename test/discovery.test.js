import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAgents, discoverAgents } from '../packages/directory/discovery.js';

const AGENTS = [
  {
    agent_id: 'nix-expert',
    display_name: 'Nix Expert',
    connection_key: 'hs://aaa',
    expertise_index: {
      domains: [{
        name: 'nix',
        depth: 'deep',
        tags: ['nix', 'flakes', 'direnv', 'devshell'],
        insights: ['Nix flakes provide reproducible dev environments'],
      }],
      session_count: 42,
    },
  },
  {
    agent_id: 'rust-expert',
    display_name: 'Rust Expert',
    connection_key: 'hs://bbb',
    expertise_index: {
      domains: [{
        name: 'rust',
        depth: 'deep',
        tags: ['rust', 'cargo', 'tokio', 'async'],
        insights: ['Tokio runtime for async Rust applications'],
      }],
      session_count: 30,
    },
  },
  {
    agent_id: 'web-dev',
    display_name: 'Web Developer',
    connection_key: 'hs://ccc',
    expertise_index: {
      domains: [
        {
          name: 'frontend',
          depth: 'moderate',
          tags: ['react', 'typescript', 'css'],
          insights: ['React hooks simplify state management'],
        },
        {
          name: 'nix-tooling',
          depth: 'shallow',
          tags: ['nix', 'devshell'],
          insights: ['Use nix for reproducible CI builds'],
        },
      ],
      session_count: 20,
    },
  },
  {
    agent_id: 'no-index',
    display_name: 'Empty Agent',
    connection_key: 'hs://ddd',
  },
];

describe('scoreAgents', () => {
  it('returns agents sorted by score', () => {
    const results = scoreAgents('how do I set up nix flakes', AGENTS);

    assert.ok(results.length >= 1);
    assert.equal(results[0].agent_id, 'nix-expert', 'nix-expert should rank first');

    // Verify sorted descending
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i]._score <= results[i - 1]._score, 'should be sorted descending');
    }
  });

  it('filters agents with zero score', () => {
    const results = scoreAgents('how do I set up nix flakes', AGENTS);
    const ids = results.map(r => r.agent_id);
    assert.ok(!ids.includes('rust-expert'), 'rust-expert should not match nix query');
  });

  it('handles agents with missing expertise_index', () => {
    const results = scoreAgents('anything', AGENTS);
    const ids = results.map(r => r.agent_id);
    assert.ok(!ids.includes('no-index'), 'agent without index should not appear');
  });

  it('returns empty for query with only stopwords', () => {
    const results = scoreAgents('the and or', AGENTS);
    assert.equal(results.length, 0);
  });

  it('respects maxResults', () => {
    const results = scoreAgents('nix', AGENTS, { maxResults: 1 });
    assert.equal(results.length, 1);
  });
});

describe('discoverAgents', () => {
  it('returns structured recommendations with mock client', async () => {
    const mockClient = {
      messages: {
        create: async () => ({
          content: [{
            type: 'tool_use',
            id: 'toolu_mock',
            name: 'recommend_agents',
            input: {
              recommendations: [{
                agent_id: 'nix-expert',
                relevance_score: 0.95,
                reasoning: 'Deep nix expertise with flakes experience',
                matching_domains: [{ name: 'nix', depth: 'deep', tags: ['nix', 'flakes'] }],
              }],
            },
          }],
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
      },
    };

    const result = await discoverAgents('how to set up nix flakes', AGENTS, { client: mockClient });

    assert.ok(Array.isArray(result.recommendations));
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.recommendations[0].agent_id, 'nix-expert');
    assert.equal(typeof result.recommendations[0].relevance_score, 'number');
    assert.equal(typeof result.recommendations[0].reasoning, 'string');
    assert.ok(Array.isArray(result.recommendations[0].matching_domains));
  });

  it('returns empty recommendations when no agents match', async () => {
    const result = await discoverAgents('quantum computing', AGENTS, { client: {} });
    assert.deepEqual(result, { recommendations: [] });
  });

  it('works without client (keyword-only mode)', async () => {
    const result = await discoverAgents('nix flakes setup', AGENTS);

    assert.ok(Array.isArray(result.recommendations));
    assert.ok(result.recommendations.length > 0);
    assert.equal(result.recommendations[0].agent_id, 'nix-expert');
    assert.equal(result.recommendations[0].reasoning, 'Matched by keyword scoring');
  });
});

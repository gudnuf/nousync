import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { retrieveRelevantSessions } from '../packages/core/retrieval.js';
import { serialize } from '../packages/core/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, 'fixtures', 'seed-sessions');
const INDEX_PATH = join(SEED_DIR, 'expertise_index.yaml');

describe('retrieveRelevantSessions', () => {
  it('returns relevant sessions for a matching question', async () => {
    const result = await retrieveRelevantSessions(
      'How do I set up a Nix flake with direnv?',
      SEED_DIR, INDEX_PATH,
    );

    assert.ok(result.sessions.length > 0, 'should return at least one session');
    assert.ok(result.query.keywords.length > 0, 'should extract keywords');
    assert.ok(result.query.keywords.includes('nix'), 'should include "nix" keyword');
    assert.ok(result.query.keywords.includes('flake'), 'should include "flake" keyword');

    // The nousphere session has nix-flake-direnv tag
    const sessionIds = result.sessions.map(s => s.frontmatter.session_id);
    assert.ok(
      sessionIds.includes('0c5c4f5a-a2d0-48fd-bb63-645124c42a7b'),
      'should return the nousphere session (has nix-flake-direnv tag)',
    );

    // Each session should have score and matchedTags
    for (const s of result.sessions) {
      assert.ok(typeof s.score === 'number');
      assert.ok(Array.isArray(s.matchedTags));
      assert.ok(s.frontmatter);
      assert.ok(s.sections);
    }
  });

  it('returns sessions about Rust and Axum', async () => {
    const result = await retrieveRelevantSessions(
      'How do I build an SSR web app with Rust and Axum?',
      SEED_DIR, INDEX_PATH,
    );

    assert.ok(result.sessions.length > 0);
    const sessionIds = result.sessions.map(s => s.frontmatter.session_id);
    assert.ok(
      sessionIds.includes('cf1e9c09-4cd0-4320-80dc-9cf38d849da5'),
      'should return the blog session (has rust, axum tags)',
    );
  });

  it('respects maxSessions limit', async () => {
    const result = await retrieveRelevantSessions(
      'nix flake docker typescript git',
      SEED_DIR, INDEX_PATH,
      { maxSessions: 1 },
    );

    assert.equal(result.sessions.length, 1);
  });

  it('returns empty for empty directory', async () => {
    const emptyDir = join(__dirname, 'fixtures', `_tmp_retrieval_${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    try {
      const result = await retrieveRelevantSessions('anything', emptyDir, null);
      assert.equal(result.sessions.length, 0);
      assert.ok(result.query.keywords.length > 0);
    } finally {
      rmSync(emptyDir, { recursive: true });
    }
  });

  it('works without index file', async () => {
    const result = await retrieveRelevantSessions(
      'How do I set up a Nix flake?',
      SEED_DIR, '/nonexistent/path.yaml',
    );

    // Should still find sessions by scanning all files
    assert.ok(result.sessions.length > 0, 'should find sessions without index');
  });

  it('filters stopwords from keywords', async () => {
    const result = await retrieveRelevantSessions(
      'How do I set up the nix flake?',
      SEED_DIR, INDEX_PATH,
    );

    assert.ok(!result.query.keywords.includes('how'));
    assert.ok(!result.query.keywords.includes('the'));
    assert.ok(!result.query.keywords.includes('do'));
    assert.ok(result.query.keywords.includes('nix'));
    assert.ok(result.query.keywords.includes('set'));
    assert.ok(result.query.keywords.includes('flake'));
  });

  it('returns matched domains when index is used', async () => {
    const result = await retrieveRelevantSessions(
      'nix flake direnv setup',
      SEED_DIR, INDEX_PATH,
    );

    assert.ok(result.query.matchedDomains.length > 0, 'should have matched domains');
  });

  it('ranks results by score descending', async () => {
    const result = await retrieveRelevantSessions(
      'nix flake docker typescript git pre-commit hooks',
      SEED_DIR, INDEX_PATH,
    );

    if (result.sessions.length >= 2) {
      for (let i = 1; i < result.sessions.length; i++) {
        assert.ok(
          result.sessions[i - 1].score >= result.sessions[i].score,
          'sessions should be sorted by score descending',
        );
      }
    }
  });
});

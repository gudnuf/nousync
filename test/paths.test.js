import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('paths', () => {
  it('defaults to ~/.nousync', async () => {
    // Clear override to test default
    const saved = process.env.NOUSYNC_HOME;
    delete process.env.NOUSYNC_HOME;

    // Re-import to get fresh module (dynamic import always re-evaluates)
    const { nousyncHome, sessionsDir, indexesDir, claudeProjectsDir } = await import('../packages/core/paths.js');

    assert.equal(nousyncHome(), join(homedir(), '.nousync'));
    assert.equal(sessionsDir(), join(homedir(), '.nousync', 'sessions'));
    assert.equal(indexesDir(), join(homedir(), '.nousync', 'indexes'));
    assert.equal(claudeProjectsDir(), join(homedir(), '.claude', 'projects'));

    if (saved) process.env.NOUSYNC_HOME = saved;
  });

  it('respects NOUSYNC_HOME override', async () => {
    process.env.NOUSYNC_HOME = '/tmp/test-nousync';
    const { nousyncHome, sessionsDir, indexesDir } = await import('../packages/core/paths.js');

    assert.equal(nousyncHome(), '/tmp/test-nousync');
    assert.equal(sessionsDir(), '/tmp/test-nousync/sessions');
    assert.equal(indexesDir(), '/tmp/test-nousync/indexes');

    delete process.env.NOUSYNC_HOME;
  });
});

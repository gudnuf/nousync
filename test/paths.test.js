import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('paths', () => {
  it('defaults to ~/.nousphere', async () => {
    // Clear override to test default
    const saved = process.env.NOUSPHERE_HOME;
    delete process.env.NOUSPHERE_HOME;

    // Re-import to get fresh module (dynamic import always re-evaluates)
    const { nousphereHome, sessionsDir, indexesDir, claudeProjectsDir } = await import('../packages/core/paths.js');

    assert.equal(nousphereHome(), join(homedir(), '.nousphere'));
    assert.equal(sessionsDir(), join(homedir(), '.nousphere', 'sessions'));
    assert.equal(indexesDir(), join(homedir(), '.nousphere', 'indexes'));
    assert.equal(claudeProjectsDir(), join(homedir(), '.claude', 'projects'));

    if (saved) process.env.NOUSPHERE_HOME = saved;
  });

  it('respects NOUSPHERE_HOME override', async () => {
    process.env.NOUSPHERE_HOME = '/tmp/test-nousphere';
    const { nousphereHome, sessionsDir, indexesDir } = await import('../packages/core/paths.js');

    assert.equal(nousphereHome(), '/tmp/test-nousphere');
    assert.equal(sessionsDir(), '/tmp/test-nousphere/sessions');
    assert.equal(indexesDir(), '/tmp/test-nousphere/indexes');

    delete process.env.NOUSPHERE_HOME;
  });
});

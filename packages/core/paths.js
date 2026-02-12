import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const home = () => process.env.NOUSPHERE_HOME || join(homedir(), '.nousphere');

export function nousphereHome() {
  return home();
}

export function sessionsDir({ ensure = false } = {}) {
  const dir = join(home(), 'sessions');
  if (ensure) mkdirSync(dir, { recursive: true });
  return dir;
}

export function indexesDir({ ensure = false } = {}) {
  const dir = join(home(), 'indexes');
  if (ensure) mkdirSync(dir, { recursive: true });
  return dir;
}

export function transcriptsGlob() {
  return join(homedir(), '.claude', 'projects', '*', '*.jsonl');
}

export function claudeProjectsDir() {
  return join(homedir(), '.claude', 'projects');
}

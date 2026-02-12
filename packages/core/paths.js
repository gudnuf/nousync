import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const home = () => process.env.NOUSYNC_HOME || join(homedir(), '.nousync');

export function nousyncHome() {
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

export function seedPath() {
  return join(home(), 'server.seed');
}

export function configPath() {
  return join(home(), 'config.yaml');
}

export function loadConfig() {
  try {
    const content = readFileSync(configPath(), 'utf8');
    return yaml.load(content) || {};
  } catch {
    return {};
  }
}

export function ensureApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return;
  const config = loadConfig();
  if (config.anthropic_api_key) {
    process.env.ANTHROPIC_API_KEY = config.anthropic_api_key;
  }
}

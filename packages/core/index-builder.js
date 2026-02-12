import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'glob';
import yaml from 'js-yaml';
import Anthropic from '@anthropic-ai/sdk';
import { parse } from './schema.js';

const INDEX_TOOL = {
  name: 'save_expertise_index',
  description: 'Save the expertise index grouping sessions into domains.',
  input_schema: {
    type: 'object',
    required: ['domains'],
    properties: {
      domains: {
        type: 'array',
        description: 'Expertise domains grouping the sessions',
        items: {
          type: 'object',
          required: ['name', 'summary', 'depth', 'tags', 'sessions', 'key_insights'],
          properties: {
            name:         { type: 'string', description: 'Short domain name (2-4 words)' },
            summary:      { type: 'string', description: '1-sentence description of what this domain covers' },
            depth:        { type: 'string', enum: ['deep', 'working', 'surface'], description: 'deep (5+ sessions or complex work), working (2-4 sessions), surface (1 session or shallow)' },
            tags:         { type: 'array', items: { type: 'string' }, description: 'Aggregated unique tags from sessions in this domain' },
            sessions:     { type: 'array', items: { type: 'string' }, description: 'Session IDs belonging to this domain' },
            key_insights: { type: 'array', items: { type: 'string' }, description: 'Key insights from sessions in this domain' },
          },
        },
      },
    },
  },
};

const CLUSTERING_PROMPT = `You are organizing a collection of Claude Code session logs into an expertise index.

Group the sessions below into 3-7 expertise domains by calling the save_expertise_index tool. Sessions may appear in multiple domains if they span multiple areas of expertise.

Priorities:
1. Group by technical domain, not by project name
2. Use descriptive domain names (2-4 words)
3. Assign depth honestly: deep (5+ sessions or complex work), working (2-4 sessions), surface (1 session)
4. Aggregate tags from all sessions in each domain
5. Include key_insight values from sessions in each domain`;

export async function buildIndex(sessionsDir, outputPath, options = {}) {
  const pattern = `${sessionsDir}/**/*.md`;
  const files = await glob(pattern);

  if (files.length === 0) {
    const emptyIndex = { domains: [], session_count: 0, generated_at: new Date().toISOString() };
    if (outputPath) writeFileSync(outputPath, yaml.dump(emptyIndex));
    return emptyIndex;
  }

  const sessionSummaries = [];
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8');
      const sessionLog = parse(content);
      const fm = sessionLog.frontmatter;
      sessionSummaries.push({
        session_id: fm.session_id,
        task: fm.task,
        outcome: fm.outcome,
        tags: fm.tags || [],
        stack: fm.stack || [],
        duration_minutes: fm.duration_minutes,
        key_insight: fm.key_insight,
        confidence: fm.confidence,
      });
    } catch {
      // skip unparseable files
    }
  }

  if (sessionSummaries.length < 2) {
    const singleDomain = sessionSummaries.length === 1
      ? {
          name: 'General',
          summary: sessionSummaries[0].task || 'Single session',
          depth: 'surface',
          tags: sessionSummaries[0].tags,
          sessions: [sessionSummaries[0].session_id],
          key_insights: [sessionSummaries[0].key_insight].filter(Boolean),
        }
      : null;

    const index = {
      domains: singleDomain ? [singleDomain] : [],
      session_count: sessionSummaries.length,
      generated_at: new Date().toISOString(),
    };
    if (outputPath) writeFileSync(outputPath, yaml.dump(index));
    return index;
  }

  const summaryText = sessionSummaries
    .map((s, i) => `Session ${i + 1}:
  ID: ${s.session_id}
  Task: ${s.task}
  Outcome: ${s.outcome}
  Tags: ${s.tags.join(', ')}
  Stack: ${s.stack.join(', ')}
  Duration: ${s.duration_minutes} min
  Key insight: ${s.key_insight}
  Confidence: ${s.confidence}`)
    .join('\n\n');

  const client = options.client || new Anthropic();
  const model = options.model || 'claude-sonnet-4-5-20250929';

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    tools: [INDEX_TOOL],
    tool_choice: { type: 'tool', name: 'save_expertise_index' },
    messages: [
      { role: 'user', content: `${CLUSTERING_PROMPT}\n\n${summaryText}` },
    ],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Model did not call save_expertise_index tool');
  }

  const index = {
    domains: toolUse.input.domains,
    session_count: sessionSummaries.length,
    generated_at: new Date().toISOString(),
  };

  if (outputPath) writeFileSync(outputPath, yaml.dump(index));
  return index;
}

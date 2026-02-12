import Anthropic from '@anthropic-ai/sdk';
import { parseTranscript } from './transcript-parser.js';
import { validate, serialize } from './schema.js';

const DISTILL_TOOL = {
  name: 'save_session_log',
  description: 'Save a distilled session log extracted from the transcript.',
  input_schema: {
    type: 'object',
    required: [
      'session_id', 'timestamp', 'project', 'task', 'outcome',
      'tags', 'stack', 'tools_used', 'duration_minutes',
      'key_insight', 'confidence',
      'what_was_built', 'what_failed_first', 'what_worked', 'gotchas', 'code_patterns',
    ],
    properties: {
      session_id:       { type: 'string', description: 'Session UUID from metadata' },
      timestamp:        { type: 'string', description: 'ISO 8601 timestamp of session start' },
      project:          { type: 'string', description: 'Project name from working directory' },
      task:             { type: 'string', description: '1-sentence description of what the session aimed to do' },
      outcome:          { type: 'string', enum: ['success', 'partial', 'failed', 'exploratory'], description: 'Session outcome' },
      tags:             { type: 'array', items: { type: 'string' }, description: 'Specific, searchable tags (e.g. "holesail-p2p" not "networking")' },
      stack:            { type: 'array', items: { type: 'string' }, description: 'Technologies used (e.g. ["node", "express"])' },
      tools_used:       { type: 'array', items: { type: 'string' }, description: 'Notable agent tools that did the real work (not routine reads)' },
      files_touched:    { type: 'array', items: { type: 'string' }, description: 'Most important files involved. Omit trivial ones.' },
      duration_minutes: { type: 'number', description: 'Session duration in minutes' },
      key_insight:      { type: 'string', description: 'Single most valuable takeaway — actionable and specific' },
      confidence:       { type: 'string', enum: ['high', 'medium', 'low'], description: 'How clear the outcome is' },
      agent_name:       { type: 'string', description: 'Agent name from metadata (e.g. "claude-code")' },
      agent_version:    { type: 'string', description: 'Agent version from metadata' },
      model:            { type: 'string', description: 'Model identifier from metadata' },
      git_branch:       { type: 'string', description: 'Git branch from metadata' },
      git_commit:       { type: ['string', 'null'], description: 'Last commit hash found in transcript, or null' },
      git_remote:       { type: ['string', 'null'], description: 'Git remote URL if found, or null' },
      what_was_built:   { type: 'string', description: '2-4 sentences describing the concrete output' },
      what_failed_first: { type: 'string', description: 'Dead ends, wrong approaches, errors. Most valuable section. "No significant failures." if straightforward.' },
      what_worked:      { type: 'string', description: 'The successful approach and why it worked' },
      gotchas:          { type: 'string', description: 'Non-obvious things that would trip someone up' },
      code_patterns:    { type: 'string', description: 'Reusable patterns, commands, or configurations discovered' },
    },
  },
};

const DISTILLATION_PROMPT = `You are a knowledge distiller for AI coding agent sessions. Analyze the transcript and extract structured, reusable knowledge by calling the save_session_log tool.

Priorities:
1. Identify what was being built and why
2. Extract failures and dead ends (highest value knowledge)
3. Capture non-obvious gotchas that would save someone time
4. Generate specific, searchable tags (e.g. "holesail-p2p" not "networking", "nix-flake-direnv" not "devops")
5. Assign honest confidence based on outcome clarity
6. Discard noise (routine file reads, linting, typo fixes)
7. Use thinking blocks as reasoning evidence when present

Outcome values:
- success: task completed as intended
- partial: some progress but not fully done
- failed: task abandoned or blocked
- exploratory: research/investigation session, no concrete deliverable expected

You MUST call the save_session_log tool with your analysis.`;

function toolInputToSessionLog(input, metadata) {
  return {
    frontmatter: {
      session_id:       input.session_id,
      timestamp:        input.timestamp,
      project:          input.project,
      task:             input.task,
      outcome:          input.outcome,
      tags:             input.tags,
      stack:            input.stack || [],
      tools_used:       input.tools_used || [],
      files_touched:    input.files_touched || [],
      duration_minutes: input.duration_minutes,
      key_insight:      input.key_insight,
      confidence:       input.confidence,
      agent_name:       input.agent_name || metadata.agentName,
      agent_version:    input.agent_version || metadata.agentVersion,
      model:            input.model || metadata.model,
      git_branch:       input.git_branch || metadata.gitBranch,
      git_commit:       input.git_commit || null,
      git_remote:       input.git_remote || null,
    },
    sections: {
      'What Was Built':    input.what_was_built,
      'What Failed First': input.what_failed_first,
      'What Worked':       input.what_worked,
      'Gotchas':           input.gotchas,
      'Code Patterns':     input.code_patterns,
    },
  };
}

export async function distill(transcriptPath, options = {}) {
  const { messages, metadata } = parseTranscript(transcriptPath, options);

  if (messages.length === 0) {
    throw new Error('Transcript has no conversation messages to distill');
  }

  const conversationText = messages
    .map(m => `[${m.role.toUpperCase()}]\n${m.content}`)
    .join('\n\n---\n\n');

  const contextBlock = `Session metadata:
- Session ID: ${metadata.sessionId}
- Project: ${metadata.project}
- Started: ${metadata.timestamps.first || 'unknown'}
- Duration: ${metadata.durationMinutes} minutes
- Tools used: ${metadata.toolsUsed.join(', ') || 'none'}
- Files touched: ${metadata.filesTouched.length} files${metadata.filesTouched.length > 0 ? ' (' + metadata.filesTouched.slice(0, 20).join(', ') + ')' : ''}
- Working directory: ${metadata.cwd}
- Agent: ${metadata.agentName} ${metadata.agentVersion || ''}
- Model: ${metadata.model || 'unknown'}
- Git branch: ${metadata.gitBranch || 'unknown'}
- Git commit: ${metadata.gitCommit || 'none found'}
- Git remote: ${metadata.gitRemote || 'none found'}

Transcript:

${conversationText}`;

  const client = options.client || new Anthropic();
  const model = options.model || 'claude-sonnet-4-5-20250929';

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    tools: [DISTILL_TOOL],
    tool_choice: { type: 'tool', name: 'save_session_log' },
    messages: [
      { role: 'user', content: `${DISTILLATION_PROMPT}\n\n${contextBlock}` },
    ],
  });

  // Extract the tool call input
  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Model did not call save_session_log tool');
  }

  const input = toolUse.input;
  const sessionLog = toolInputToSessionLog(input, metadata);
  const markdown = serialize(sessionLog);
  const validation = validate(sessionLog);

  return {
    sessionLog,
    markdown,
    toolInput: input,
    validation,
    metadata,
    usage: response.usage,
  };
}

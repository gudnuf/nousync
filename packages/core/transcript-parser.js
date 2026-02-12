import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const KEEP_TYPES = new Set(['user', 'assistant']);
const MAX_TOOL_RESULT_CHARS = 500;
const TIER2_THINKING_CHARS = 200;
const TIER1_MAX_CHARS = 80_000;

const FILE_PATH_TOOLS = new Set(['Read', 'Write', 'Edit']);
const COMMIT_HASH_RE = /\b([a-f0-9]{7,40})\]/;
const GIT_COMMIT_OUTPUT_RE = /^\[[\w/.-]+ ([a-f0-9]{7,40})\]/m;
const GIT_REMOTE_RE = /(?:git@|https:\/\/)([^\s]+?)(?:\.git)?\s/;

function summarizeToolUse(block) {
  const name = block.name || 'Unknown';
  const input = block.input || {};

  switch (name) {
    case 'Read':
      return `[Tool: Read] ${input.file_path || ''}`;
    case 'Write':
      return `[Tool: Write] ${input.file_path || ''}`;
    case 'Edit':
      return `[Tool: Edit] ${input.file_path || ''}`;
    case 'Bash':
      return `[Tool: Bash] ${input.command || input.description || ''}`;
    case 'Glob':
      return `[Tool: Glob] ${input.pattern || ''}`;
    case 'Grep':
      return `[Tool: Grep] ${input.pattern || ''}`;
    case 'Task':
      return `[Tool: Task] ${input.description || ''}`;
    case 'WebFetch':
      return `[Tool: WebFetch] ${input.url || ''}`;
    case 'WebSearch':
      return `[Tool: WebSearch] ${input.query || ''}`;
    default:
      return `[Tool: ${name}]`;
  }
}

function truncate(text, maxLen) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + ' [...truncated]';
}

function condenseContent(content, tier) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts = [];
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text);
        break;
      case 'thinking':
        if (tier === 2) {
          parts.push(`[Thinking] ${truncate(block.thinking, TIER2_THINKING_CHARS)}`);
        } else {
          parts.push(`[Thinking] ${block.thinking}`);
        }
        break;
      case 'tool_use':
        parts.push(summarizeToolUse(block));
        break;
      case 'tool_result':
        if (tier === 2) break; // drop entirely in tier 2
        {
          const resultText = typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content);
          parts.push(`[Result] ${truncate(resultText, MAX_TOOL_RESULT_CHARS)}`);
        }
        break;
      default:
        break;
    }
  }
  return parts.join('\n');
}

function groupConsecutive(messages) {
  const grouped = [];
  let current = null;

  for (const msg of messages) {
    const role = msg.message?.role;
    if (!role) continue;

    if (current && current.role === role) {
      current.contentBlocks.push(msg.message.content);
      current.timestamps.push(msg.timestamp);
    } else {
      if (current) grouped.push(current);
      current = {
        role,
        contentBlocks: [msg.message.content],
        timestamps: [msg.timestamp],
      };
    }
  }
  if (current) grouped.push(current);
  return grouped;
}

function extractMetadata(entries) {
  const conversationEntries = entries.filter(e => KEEP_TYPES.has(e.type) && e.message);
  const timestamps = conversationEntries
    .map(e => e.timestamp)
    .filter(Boolean)
    .sort();

  const toolsUsed = new Set();
  const filesTouched = new Set();
  let gitCommit = null;
  let gitRemote = null;
  let model = null;

  for (const entry of conversationEntries) {
    // Extract model from first assistant message that has it
    if (!model && entry.type === 'assistant' && entry.message?.model) {
      model = entry.message.model;
    }

    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === 'tool_use' && block.name) {
        toolsUsed.add(block.name);

        // Collect file paths from file-related tools
        if (FILE_PATH_TOOLS.has(block.name) && block.input?.file_path) {
          filesTouched.add(block.input.file_path);
        }
      }

      // Scan tool results for git info
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        if (!gitCommit) {
          const commitMatch = block.content.match(GIT_COMMIT_OUTPUT_RE);
          if (commitMatch) gitCommit = commitMatch[1];
        }
        if (!gitRemote) {
          const remoteMatch = block.content.match(GIT_REMOTE_RE);
          if (remoteMatch) gitRemote = remoteMatch[1];
        }
      }
    }
  }

  const first = conversationEntries[0];
  const sessionId = first?.sessionId || basename(first?.timestamp || 'unknown');
  const cwd = first?.cwd || '';
  const gitBranch = first?.gitBranch || '';
  const agentVersion = first?.version || null;
  const project = cwd ? basename(cwd) : '';

  let durationMinutes = 0;
  if (timestamps.length >= 2) {
    const start = new Date(timestamps[0]);
    const end = new Date(timestamps[timestamps.length - 1]);
    durationMinutes = Math.round((end - start) / 60_000);
  }

  return {
    sessionId,
    timestamps: { first: timestamps[0] || null, last: timestamps[timestamps.length - 1] || null },
    durationMinutes,
    toolsUsed: [...toolsUsed].sort(),
    cwd,
    gitBranch,
    // New fields
    project,
    model,
    agentName: 'claude-code',
    agentVersion,
    gitCommit,
    gitRemote,
    filesTouched: [...filesTouched].sort(),
  };
}

export function parseTranscript(transcriptPath, options = {}) {
  const raw = readFileSync(transcriptPath, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const entries = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  // Filter to user/assistant only
  const conversationEntries = entries.filter(
    e => KEEP_TYPES.has(e.type) && e.message
  );

  if (conversationEntries.length === 0) {
    // Extract sessionId from any entry, not just conversation entries
    const anyWithSession = entries.find(e => e.sessionId);
    return {
      messages: [],
      metadata: {
        sessionId: anyWithSession?.sessionId || 'unknown',
        timestamps: { first: null, last: null },
        durationMinutes: 0,
        toolsUsed: [],
        cwd: anyWithSession?.cwd || '',
        gitBranch: anyWithSession?.gitBranch || '',
        project: anyWithSession?.cwd ? basename(anyWithSession.cwd) : '',
        model: null,
        agentName: 'claude-code',
        agentVersion: anyWithSession?.version || null,
        gitCommit: null,
        gitRemote: null,
        filesTouched: [],
      },
    };
  }

  const metadata = extractMetadata(entries);
  const grouped = groupConsecutive(conversationEntries);

  // Tier 1: condense with truncated tool results
  let messages = grouped.map(g => ({
    role: g.role,
    content: g.contentBlocks.map(c => condenseContent(c, 1)).join('\n'),
  }));

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);

  // Tier 2: drop tool results, trim thinking
  if (totalChars > TIER1_MAX_CHARS) {
    messages = grouped.map(g => ({
      role: g.role,
      content: g.contentBlocks.map(c => condenseContent(c, 2)).join('\n'),
    }));
  }

  // Filter out empty messages
  messages = messages.filter(m => m.content.trim().length > 0);

  return { messages, metadata };
}

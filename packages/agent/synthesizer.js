import Anthropic from '@anthropic-ai/sdk';
import { serialize } from '../core/schema.js';

const SYNTHESIZE_TOOL = {
  name: 'synthesize_response',
  description: 'Provide a synthesized response based on experience from past sessions.',
  input_schema: {
    type: 'object',
    required: ['response', 'confidence', 'based_on_sessions', 'followup_available'],
    properties: {
      response:           { type: 'string', description: 'The synthesized answer drawing from session experience' },
      confidence:         { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence in the answer based on available session evidence' },
      based_on_sessions:  { type: 'array', items: { type: 'string' }, description: 'Session IDs that informed this answer' },
      followup_available: { type: 'boolean', description: 'Whether the agent has more relevant experience to share on follow-up' },
    },
  },
};

function buildSystemPrompt(sessions) {
  if (sessions.length === 0) {
    return `You are a knowledge agent answering questions based on your accumulated session experience.

You have no relevant sessions to draw from for this question. Respond honestly that you don't have direct experience with this topic. Set confidence to "low" and based_on_sessions to an empty array.

You MUST call the synthesize_response tool with your answer.`;
  }

  const sessionContent = sessions.map(s => {
    const md = serialize({ frontmatter: s.frontmatter, sections: s.sections });
    return `--- Session: ${s.frontmatter.session_id} ---\n${md}`;
  }).join('\n\n');

  return `You are a knowledge agent answering questions based on your accumulated session experience.

Below are relevant sessions from your past work. Answer the question by synthesizing insights from these sessions. Only state what you actually experienced — do not fabricate or extrapolate beyond the session evidence.

${sessionContent}

You MUST call the synthesize_response tool with your answer.`;
}

export async function synthesize(question, retrievedSessions, options = {}) {
  const { context, conversationHistory, client: injectedClient, model } = options;

  const systemPrompt = buildSystemPrompt(retrievedSessions);

  const messages = [];

  // Prepend conversation history for multi-turn support
  if (conversationHistory && conversationHistory.length > 0) {
    messages.push(...conversationHistory);
  }

  // Build the user message
  let userContent = question;
  if (context) {
    userContent = `Context: ${context}\n\nQuestion: ${question}`;
  }
  messages.push({ role: 'user', content: userContent });

  const client = injectedClient || new Anthropic();
  const modelId = model || 'claude-sonnet-4-5-20250929';

  const response = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    system: systemPrompt,
    tools: [SYNTHESIZE_TOOL],
    tool_choice: { type: 'tool', name: 'synthesize_response' },
    messages,
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Model did not call synthesize_response tool');
  }

  const result = toolUse.input;

  return {
    response: result.response,
    confidence: result.confidence,
    based_on_sessions: result.based_on_sessions,
    followup_available: result.followup_available,
    usage: response.usage,
  };
}

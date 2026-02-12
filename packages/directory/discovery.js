import { extractKeywords, scoreTagOverlap, scoreInsightMatch } from '../core/retrieval.js';

export function scoreAgents(query, agents, { maxResults = 10 } = {}) {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const scored = [];

  for (const agent of agents) {
    const domains = agent.expertise_index?.domains || [];
    let bestScore = 0;

    for (const domain of domains) {
      const tagScore = scoreTagOverlap(keywords, domain.tags);
      const insights = domain.insights || [];
      const bestInsight = insights.length > 0
        ? Math.max(...insights.map(i => scoreInsightMatch(keywords, i)))
        : 0;

      const domainScore = tagScore * 0.6 + bestInsight * 0.4;
      if (domainScore > bestScore) bestScore = domainScore;
    }

    if (bestScore > 0) {
      scored.push({ ...agent, _score: bestScore });
    }
  }

  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, maxResults);
}

const RECOMMEND_TOOL = {
  name: 'recommend_agents',
  description: 'Recommend agents that can best answer the user\'s query.',
  input_schema: {
    type: 'object',
    required: ['recommendations'],
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['agent_id', 'relevance_score', 'reasoning', 'matching_domains'],
          properties: {
            agent_id:        { type: 'string', description: 'ID of the recommended agent' },
            relevance_score: { type: 'number', description: 'Relevance score 0-1' },
            reasoning:       { type: 'string', description: 'Why this agent is a good match' },
            matching_domains: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name:  { type: 'string' },
                  depth: { type: 'string' },
                  tags:  { type: 'array', items: { type: 'string' } },
                },
              },
              description: 'Domains that match the query',
            },
          },
        },
      },
    },
  },
};

function buildDiscoveryPrompt(agents) {
  const profiles = agents.map(a => {
    const domains = (a.expertise_index?.domains || []).map(d =>
      `  - ${d.name} (depth: ${d.depth || 'unknown'}, tags: ${(d.tags || []).join(', ')})`
    ).join('\n');

    return `Agent: ${a.agent_id}
Display Name: ${a.display_name || a.agent_id}
Domains:
${domains}
Session Count: ${a.expertise_index?.session_count || 'unknown'}
Payment: ${a.payment ? `${a.payment.amount} ${a.payment.unit}` : 'free'}`;
  }).join('\n\n---\n\n');

  return `You are a directory service matching user queries to the best available agents.

Below are agent profiles with their expertise domains. Recommend the agents most likely to answer the query well. Consider tag relevance, domain depth, and breadth of expertise.

${profiles}

You MUST call the recommend_agents tool with your recommendations. Rank by relevance_score descending.`;
}

export async function discoverAgents(query, onlineAgents, { client, model, maxShortlist = 10 } = {}) {
  const shortlist = scoreAgents(query, onlineAgents, { maxResults: maxShortlist });

  if (shortlist.length === 0) {
    return { recommendations: [] };
  }

  // If no client provided, return scored results without LLM reasoning
  if (!client) {
    return {
      recommendations: shortlist.map(a => ({
        agent_id: a.agent_id,
        relevance_score: a._score,
        reasoning: 'Matched by keyword scoring',
        matching_domains: (a.expertise_index?.domains || []).map(d => ({
          name: d.name,
          depth: d.depth,
          tags: d.tags,
        })),
      })),
    };
  }

  const systemPrompt = buildDiscoveryPrompt(shortlist);
  const modelId = model || 'claude-sonnet-4-5-20250929';

  const response = await client.messages.create({
    model: modelId,
    max_tokens: 2048,
    system: systemPrompt,
    tools: [RECOMMEND_TOOL],
    tool_choice: { type: 'tool', name: 'recommend_agents' },
    messages: [{ role: 'user', content: query }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) {
    return { recommendations: [] };
  }

  return { recommendations: toolUse.input.recommendations };
}

import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { glob } from 'glob';
import yaml from 'js-yaml';
import { parse } from './schema.js';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'not',
  'no', 'nor', 'so', 'if', 'then', 'than', 'that', 'this', 'these',
  'those', 'it', 'its', 'i', 'me', 'my', 'we', 'us', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
  'what', 'which', 'who', 'when', 'where', 'how', 'why', 'all', 'each',
  'every', 'any', 'some', 'about', 'up', 'out', 'just', 'also', 'very',
]);

export function extractKeywords(text) {
  return text
    .split(/\W+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

export function scoreTagOverlap(keywords, tags) {
  if (!tags || tags.length === 0) return 0;
  const tagWords = new Set(tags.flatMap(t => t.toLowerCase().split(/[-_\s]+/)));
  let hits = 0;
  for (const kw of keywords) {
    if (tagWords.has(kw)) hits++;
    // Also check if keyword is substring of any tag
    for (const tag of tags) {
      if (tag.toLowerCase().includes(kw) && !tagWords.has(kw)) {
        hits += 0.5;
        break;
      }
    }
  }
  return keywords.length > 0 ? hits / keywords.length : 0;
}

export function scoreInsightMatch(keywords, insight) {
  if (!insight) return 0;
  const insightWords = new Set(insight.toLowerCase().split(/\W+/).filter(w => w.length > 1));
  let hits = 0;
  for (const kw of keywords) {
    if (insightWords.has(kw)) hits++;
  }
  return keywords.length > 0 ? hits / keywords.length : 0;
}

export function scoreRecency(timestamp) {
  if (!timestamp) return 0;
  const age = Date.now() - new Date(timestamp).getTime();
  const daysOld = age / (1000 * 60 * 60 * 24);
  // Decay over 90 days: 1.0 for today, ~0.0 for 90+ days
  return Math.max(0, 1 - daysOld / 90);
}

export async function retrieveRelevantSessions(question, sessionsDir, indexPath, { maxSessions = 5 } = {}) {
  const keywords = extractKeywords(question);

  // Try to load expertise index for domain-guided retrieval
  let index = null;
  let matchedDomains = [];
  let candidateIds = null;

  if (indexPath) {
    try {
      const indexContent = readFileSync(indexPath, 'utf8');
      index = yaml.load(indexContent);
    } catch {
      // Fall through to scanning all sessions
    }
  }

  if (index && index.domains) {
    // Score domains by tag overlap with keywords
    const scoredDomains = index.domains.map(domain => ({
      ...domain,
      score: scoreTagOverlap(keywords, domain.tags),
    }));

    matchedDomains = scoredDomains
      .filter(d => d.score > 0)
      .sort((a, b) => b.score - a.score);

    if (matchedDomains.length > 0) {
      candidateIds = new Set(matchedDomains.flatMap(d => d.sessions));
    }
  }

  // Load session files
  const pattern = `${sessionsDir}/**/*.md`;
  const files = await glob(pattern);

  if (files.length === 0) {
    return { sessions: [], query: { keywords, matchedDomains: matchedDomains.map(d => d.name) } };
  }

  const sessions = [];
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8');
      const sessionLog = parse(content);
      const fm = sessionLog.frontmatter;

      // If we have candidate IDs from index, filter
      if (candidateIds && !candidateIds.has(fm.session_id)) continue;

      const tagScore = scoreTagOverlap(keywords, [...(fm.tags || []), ...(fm.stack || [])]);
      const insightScore = scoreInsightMatch(keywords, fm.key_insight);
      const recencyScore = scoreRecency(fm.timestamp);

      const score = tagScore * 0.5 + insightScore * 0.3 + recencyScore * 0.2;

      const matchedTags = [...(fm.tags || []), ...(fm.stack || [])].filter(tag => {
        const tagLower = tag.toLowerCase();
        return keywords.some(kw => tagLower.includes(kw) || tagLower.split(/[-_]/).includes(kw));
      });

      sessions.push({
        frontmatter: fm,
        sections: sessionLog.sections,
        score,
        matchedTags,
        file: basename(file),
      });
    } catch {
      // Skip unparseable files
    }
  }

  // Sort by score descending, take top N
  sessions.sort((a, b) => b.score - a.score);
  const topSessions = sessions.slice(0, maxSessions);

  return {
    sessions: topSessions,
    query: { keywords, matchedDomains: matchedDomains.map(d => d.name) },
  };
}

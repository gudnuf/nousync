import matter from 'gray-matter';

const REQUIRED_FIELDS = ['session_id', 'timestamp', 'project', 'task', 'outcome', 'tags', 'duration_minutes', 'key_insight', 'confidence'];
const OUTCOME_VALUES = new Set(['success', 'partial', 'failed', 'exploratory', 'undistilled']);
const CONFIDENCE_VALUES = new Set(['high', 'medium', 'low']);
const EXPECTED_SECTIONS = ['What Was Built', 'What Failed First', 'What Worked', 'Gotchas', 'Code Patterns'];

// Optional fields that get validated if present
const ARRAY_FIELDS = ['tags', 'stack', 'tools_used', 'files_touched'];

export function parse(markdownString) {
  const { data: frontmatter, content } = matter(markdownString);

  const sections = {};
  const sectionRegex = /^## (.+)$/gm;
  let match;
  const sectionStarts = [];

  while ((match = sectionRegex.exec(content)) !== null) {
    sectionStarts.push({ name: match[1].trim(), index: match.index + match[0].length });
  }

  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i].index;
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index - sectionStarts[i + 1].name.length - 3 : content.length;
    sections[sectionStarts[i].name] = content.slice(start, end).trim();
  }

  return { frontmatter, sections, raw: markdownString };
}

export function validate(sessionLog) {
  const errors = [];

  const fm = sessionLog.frontmatter || {};

  for (const field of REQUIRED_FIELDS) {
    if (fm[field] === undefined || fm[field] === null || fm[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (fm.outcome && !OUTCOME_VALUES.has(fm.outcome)) {
    errors.push(`Invalid outcome: "${fm.outcome}". Must be one of: ${[...OUTCOME_VALUES].join(', ')}`);
  }

  if (fm.confidence && !CONFIDENCE_VALUES.has(fm.confidence)) {
    errors.push(`Invalid confidence: "${fm.confidence}". Must be one of: high, medium, low`);
  }

  for (const field of ARRAY_FIELDS) {
    if (fm[field] !== undefined && !Array.isArray(fm[field])) {
      errors.push(`${field} must be an array`);
    }
  }

  if (fm.tags && Array.isArray(fm.tags) && fm.tags.length === 0) {
    errors.push('tags must not be empty');
  }

  if (fm.duration_minutes !== undefined && typeof fm.duration_minutes !== 'number') {
    errors.push('duration_minutes must be a number');
  }

  const sections = sessionLog.sections || {};
  for (const section of EXPECTED_SECTIONS) {
    if (!sections[section] || sections[section].trim().length === 0) {
      errors.push(`Missing or empty section: ${section}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function serialize(sessionLog) {
  const fm = { ...sessionLog.frontmatter };
  let body = '';

  for (const section of EXPECTED_SECTIONS) {
    const content = sessionLog.sections?.[section] || '';
    body += `## ${section}\n\n${content}\n\n`;
  }

  // Include any extra sections not in EXPECTED_SECTIONS
  if (sessionLog.sections) {
    for (const [name, content] of Object.entries(sessionLog.sections)) {
      if (!EXPECTED_SECTIONS.includes(name)) {
        body += `## ${name}\n\n${content}\n\n`;
      }
    }
  }

  return matter.stringify(body.trimEnd() + '\n', fm);
}

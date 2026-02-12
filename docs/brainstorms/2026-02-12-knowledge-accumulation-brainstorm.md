# Nousphere: Knowledge Accumulation for Claude Code

**Date:** 2026-02-12
**Status:** Brainstorm

## What We're Building

A standalone knowledge accumulation system that automatically captures what was done and why at the end of meaningful Claude Code sessions. Logs are stored globally at `~/.nousphere/`, indexed with YAML frontmatter for later discovery via grep and a generated index.

This is **not** a replacement for Claude's built-in memory system. It's a parallel, more detailed record — a journal of engineering sessions that compounds over time.

## Why This Approach

### Hybrid: Behavioral Skill + Stop Hook Completion Step

- A **Claude Code skill** handles distillation mid-session. Claude has full session context, can judge significance, write rich summaries, and ask the human one check-in question before saving.
- A **stop hook** acts as a completion step — it always runs at session end to ensure the record is finalized, even if the skill already captured during the session (e.g., appends final state, marks entry as complete).
- Knowledge lives at `~/.nousphere/` — hidden, dedicated, global across all projects.

### Alternatives Considered

| Approach | Rejected Because |
|----------|-----------------|
| Pure stop hook | Loses conversation context; needs separate API call to re-distill |
| Pure behavioral skill | No safety net; relies entirely on Claude remembering |
| Integrate with MEMORY.md | Couples to Claude's internals; we want standalone |

## Key Decisions

1. **Trigger:** Session end (when session was meaningful — Claude judges significance)
2. **Storage:** `~/.nousphere/sessions/` for individual logs
3. **Autonomy:** Claude drafts autonomously, then asks one open-ended question ("anything to add about what worked or didn't?") before saving
4. **Granularity:** Meaningful sessions only — skip trivial Q&A or single-line fixes. Heuristic: session involved multi-file changes, debugging, architectural decisions, or new feature work
5. **Discovery:** Grep frontmatter fields + auto-generated `~/.nousphere/index.md`
6. **Independence:** Does not interfere with Claude's MEMORY.md or built-in systems

## Schema

### Frontmatter (YAML)

```yaml
---
session_id: "2026-02-12-auth-refactor"  # timestamp-slug format
timestamp: 2026-02-12T14:30:00Z
project: <project name or path>
task: "Brief description of what was attempted"
outcome: success | partial | failed | exploratory | undistilled
tags: [authentication, refactor, bug-fix]
stack: [ruby, rails, postgres]
key_insight: "One-sentence takeaway"
confidence: high | medium | low  # confidence in the key_insight / approach taken
---
```

### Body (Markdown)

```markdown
## What Was Built
Brief description of the end result.

## What Failed First
Approaches that didn't work and why.

## What Worked
The successful approach and why it succeeded.

## Gotchas
Surprising behaviors, undocumented quirks, environment issues.

## Code Patterns
Reusable patterns, snippets, or architectural decisions worth remembering.
```

## Components

### 1. Skill: `/nousphere:capture`
- Contains the schema template and distillation instructions
- Claude reviews the session, drafts the entry
- Asks human: "Anything to add about what worked or what was frustrating?"
- Writes to `~/.nousphere/sessions/YYYY-MM-DD-<slug>.md`
- Regenerates `~/.nousphere/index.md`

### 2. Global CLAUDE.md Instruction
- Added to `~/.claude/CLAUDE.md`
- Tells Claude: "Before ending any meaningful session, run nousphere capture"

### 3. Stop Hook (Breadcrumb / Completion Step)
- Claude Code hook on the `stop` event
- Always runs — no API calls, purely local data collection
- Captures: conversation ID, timestamp, working directory, git branch, git diff summary, recent commit messages
- If capture skill already ran: no-op or appends final git state to existing entry
- If capture skill didn't run: writes a **stub entry** with the ambient metadata and conversation ID, marked as `outcome: undistilled` — enough to go back and distill later

### 4. Index Generator
- Part of the capture skill
- Regenerates `~/.nousphere/index.md` after each new entry
- Groups by project, sorted by date, shows key_insight for each

## Directory Structure

```
~/.nousphere/
  sessions/
    2026-02-12-auth-refactor.md
    2026-02-11-api-rate-limiting.md
    ...
  index.md          # Auto-generated overview
```

## Resolved Questions

1. **Stop hook mechanics:** Hook always runs as a completion step, not just a fallback. Ensures record is finalized regardless of whether the skill ran mid-session.
2. **Session ID format:** Timestamp-slug (`2026-02-12-auth-refactor`) — human-readable, naturally sorted, doubles as filename. On collision, append `-2`, `-3`, etc.
3. **Skill distribution:** Lives in the nousphere repo initially. Later becomes installable to any user's system.

## Open Questions

_(None remaining)_

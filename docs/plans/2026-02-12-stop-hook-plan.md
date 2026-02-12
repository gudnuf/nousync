# Plan: Stop Hook for Nousync Session Logging

## Context

Nousync captures structured knowledge from Claude Code sessions. We've built the core pipeline (transcript parser, distiller, schema) but nothing runs automatically yet. The stop hook is the foundation — it fires at every session end and guarantees we have at least a breadcrumb for every meaningful session, even if the capture skill (not yet built) doesn't run.

The hook makes **zero API calls**. It extracts ambient metadata from the transcript and writes a stub entry marked `outcome: undistilled`. Stubs can be upgraded later via `distill-one.js`.

## Files to change

| File | Action | Why |
|------|--------|-----|
| `packages/core/schema.js` | Modify | Export `REQUIRED_FIELDS`, `EXPECTED_SECTIONS` constants |
| `packages/core/transcript-parser.js` | Modify | Add `realUserMessageCount` to metadata |
| `packages/core/stub.js` | **Create** | `createStub()` + `isTrivialSession()` |
| `scripts/stop-hook.js` | **Create** | Hook entry point |
| `test/stub.test.js` | **Create** | Unit tests for stub module |
| `test/fixtures/sample-transcript-trivial.jsonl` | **Create** | Fixture for trivial-session heuristic |
| `.claude/settings.json` | Modify | Register the Stop hook |

## Implementation steps

### 1. Export constants from `packages/core/schema.js`

Change `const` to `export const` for `REQUIRED_FIELDS`, `EXPECTED_SECTIONS`, `OUTCOME_VALUES`, `CONFIDENCE_VALUES`. Non-breaking — internal usage unaffected.

### 2. Add `realUserMessageCount` to transcript parser metadata

In `packages/core/transcript-parser.js`, inside `extractMetadata()`, count entries where `type === 'user'` and `message.content` is a string (not a tool_result array). Add to the returned metadata object. Also add to the empty-transcript fallback return.

### 3. Create `packages/core/stub.js`

Two exports:

**`isTrivialSession(metadata)`** — returns `true` if session should be skipped:
- `realUserMessageCount < 2` AND no mutating tools (`Write`, `Edit`, `Bash`)
- A single prompt that triggered Write/Bash is still meaningful

**`createStub(metadata, transcriptPath)`** — returns `{ frontmatter, sections, filename }`:
- Frontmatter: all metadata fields + `outcome: 'undistilled'`, `task: '[undistilled]'`, `tags: ['undistilled']`, `key_insight: '[undistilled]'`, `confidence: 'low'`, `transcript_path`, `cwd`
- Sections: all 5 expected sections with placeholder `'[stub — pending distillation]'`
- Filename: `YYYY-MM-DD-<project-slug>-<session-id-first-8>.md`

Stubs pass `validate()` with no schema changes needed (all required fields populated, `undistilled` is already a valid outcome).

### 4. Create `scripts/stop-hook.js`

Shebang script, reads hook JSON from stdin. Flow:

1. Parse stdin → get `session_id`, `transcript_path`
2. Ensure `~/.nousync/sessions/` exists (`mkdirSync` recursive)
3. Scan existing session files for matching `session_id` → exit if found (skill already ran)
4. `parseTranscript(transcript_path)` → get metadata
5. `isTrivialSession(metadata)` → exit if trivial
6. `createStub(metadata, transcript_path)` → build stub
7. `serialize(stub)` → write to `~/.nousync/sessions/<filename>`

**Critical**: fail-silent everywhere. A stop hook must never crash or block the user's session. Every error path exits with code 0.

Support `NOUSYNC_HOME` env var override for testability (defaults to `~/.nousync`).

### 5. Create test fixture `test/fixtures/sample-transcript-trivial.jsonl`

Minimal transcript: 1 user message (string content), 1 assistant text response, no tool usage. Exercises the skip path.

### 6. Create `test/stub.test.js`

Tests for both functions:
- `createStub` produces valid session log (passes `validate()`)
- `createStub` sets `outcome: undistilled`, includes `transcript_path`
- `createStub` generates correct filename format
- `createStub` round-trips through `serialize()` → `parse()`
- `isTrivialSession` returns true for 0-1 messages + no mutating tools
- `isTrivialSession` returns false when Write/Edit/Bash used
- `isTrivialSession` returns false for 2+ real user messages

### 7. Register hook in `.claude/settings.json`

Add to the project-level settings:
```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node /Users/claude/nousphere/scripts/stop-hook.js"
      }]
    }]
  }
}
```

Absolute path so it works regardless of cwd. Later, an install script writes the correct path for other users.

## Verification

1. `node --test test/stub.test.js` — all stub unit tests pass
2. `node --test test/*.test.js` — existing tests still pass (no regressions from schema/parser changes)
3. Manual test: pipe sample hook input to the script and verify a stub file appears in `~/.nousync/sessions/`:
   ```
   echo '{"session_id":"test-123","transcript_path":"test/fixtures/sample-transcript-short.jsonl"}' | node scripts/stop-hook.js
   ls ~/.nousync/sessions/
   cat ~/.nousync/sessions/*.md
   ```
4. Verify trivial sessions are skipped:
   ```
   echo '{"session_id":"trivial-1","transcript_path":"test/fixtures/sample-transcript-trivial.jsonl"}' | node scripts/stop-hook.js
   # Should produce no new file
   ```
5. Verify duplicate detection: run step 3 again — no second file should appear

# Nousync

P2P knowledge network for Claude Code agents.

## Setup

```bash
nix develop   # or direnv allow
npm install
cp .env.example .env
# edit .env with your ANTHROPIC_API_KEY
```

## Data Layout

All distilled knowledge lives in `~/.nousync/` by default:

```
~/.nousync/
├── sessions/                          # distilled session logs
│   ├── <session-id>.md
│   └── ...
└── indexes/
    └── global_expertise_index.yaml    # cross-project expertise index
```

Raw transcripts are read from where Claude Code writes them (`~/.claude/projects/*/`).

Set `NOUSYNC_HOME` in `.env` to change the data directory. For local dev, point it at `./output` (already gitignored):

```
NOUSYNC_HOME=/Users/you/nousync/output
```

This puts sessions in `./output/sessions/` and indexes in `./output/indexes/`.

## Tests

```bash
npm test                    # unit tests (no API key needed)
npm run test:integration    # real transcript distillation (needs API key)
```

## Scripts

### Distill a transcript

```bash
node scripts/distill-one.js
```

Lists transcripts from all Claude Code projects, lets you pick one. Shows parsed metadata + condensed conversation, then press Enter to distill via Claude API.

```bash
node scripts/distill-one.js path/to/transcript.jsonl         # direct path
node scripts/distill-one.js path/to/transcript.jsonl --save   # save to $NOUSYNC_HOME/sessions/
```

### Build expertise index

After distilling some sessions with `--save`, build the index:

```bash
node scripts/build-index.js              # reads from $NOUSYNC_HOME/sessions/
node scripts/build-index.js --dry-run    # list sessions without API call
```

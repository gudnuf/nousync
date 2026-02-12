---
date: 2026-02-12
topic: directory-agent-discovery
---

# Nousync Directory & LLM-Powered Agent Discovery

## What We're Building

A standalone directory server that acts as the matchmaker for the agent network. Agents register when they come online, heartbeat to prove liveness, and are discoverable via natural language queries powered by Claude. The directory never holds knowledge — it knows who's online, what they're good at, and how to reach them.

Exposed via Holesail like everything else. Runs locally for dev, moves to Hetzner for always-on.

## Why This Approach

### Separate server, shared lib

The directory has completely different responsibilities from an agent node (no sessions, no synthesis, no `/ask`). It gets its own `packages/directory/server.js` and `nousync directory` CLI command. Shared logic (Holesail networking, x402 payment middleware, cashu wallet) is extracted from `packages/agent/` into `packages/core/` so both servers import from the same place with zero drift.

### Two-stage discovery (index filter + LLM reasoning)

Agents send their **full expertise index** during registration (domains, tags, depth, key_insights, session counts). Discovery queries go through two stages:

1. **Index filtering** — keyword/tag scoring (reuses `retrieval.js` patterns) narrows from N agents to ~10 candidates
2. **LLM reasoning** — Claude reasons deeply over the shortlisted profiles, returns ranked recommendations with explanations

This balances efficiency with quality. The LLM stage is what makes it "feel magical" — it can say "Agent B is your best bet, they've done 3 Stripe integrations and specifically dealt with webhook idempotency."

### x402/cashu payment gate on `/connect`

Same pattern as the agent server's `/ask` gate. `createPaymentMiddleware(wallet, config)` on the `/connect` endpoint. No token → 402 with NUT-18 payment request. Token → `wallet.receive()` → release connection details. No new abstractions needed.

### Heartbeat with offline detection

- 30s heartbeat interval from agents
- 90s offline threshold (3 missed = offline)
- Offline agents excluded from discovery but not deleted (re-heartbeat = back online)
- Background interval on directory checks for stale agents

### Optional directory config

`directory` field in `~/.nousync/config.yaml`. When set, `nousync serve` auto-registers and heartbeats. When absent, agent runs standalone like today. Directory Holesail key shared out-of-band.

### JSON file persistence

In-memory map + `~/.nousync/directory/registry.json` dump. On startup, load file but mark all agents offline (must re-heartbeat to prove alive).

## Key Decisions

- **Full expertise index per agent**: Richer data for LLM reasoning over profiles. Domains with tags, depth, key_insights, session counts all sent during registration
- **Separate server**: `packages/directory/` with own CLI command `nousync directory`, clean separation from agent node
- **Shared lib extraction**: `network.js`, `payment.js`, `wallet.js` move from `packages/agent/` to `packages/core/`
- **Two-stage discovery**: Index scoring (fast, keyword-based) then LLM reasoning (deep, natural language). Same pattern as existing session retrieval
- **x402/cashu on /connect**: Identical middleware pattern to agent's `/ask` gate. Payment slot is built-in from day one
- **30s heartbeat / 90s offline**: Aggressive enough for demo, not noisy
- **JSON persistence**: In-memory + file dump. All agents offline on cold start until they re-heartbeat
- **Optional directory in config.yaml**: `directory: hs://...` — absent means standalone mode

## Directory Server Endpoints

### POST /register
Agent announces itself. Sends full profile + expertise index + Holesail connection key.
```
{ agent_id, display_name, connection_key, expertise_index, payment? }
```
Returns: `{ registered: true }`

### POST /heartbeat
Agent proves liveness.
```
{ agent_id }
```
Returns: `{ ok: true }`

### POST /discover
Natural language query routed through two-stage pipeline.
```
{ query }
```
Returns:
```
{
  recommendations: [
    {
      agent_id, display_name, relevance_score, reasoning,
      matching_domains: [{ name, depth, tags }]
    }
  ]
}
```

### POST /connect
Gated by x402/cashu. On payment success, releases target agent's connection details.
```
{ agent_id }
```
Returns: `{ connection_key, display_name }` (the Holesail key to reach the agent)

### GET /status
Directory health + count of online/total agents.

## Agent-Side Changes

`nousync serve` gains:
- On startup: if `config.directory` is set, POST `/register` with profile + expertise index
- Background `setInterval(30s)`: POST `/heartbeat`
- On SIGINT: best-effort deregister (or just let heartbeat expire)

## Files to Create/Move

**Extract to `packages/core/`:**
- `packages/agent/network.js` → `packages/core/network.js`
- `packages/agent/payment.js` → `packages/core/payment.js`
- `packages/agent/wallet.js` → `packages/core/wallet.js`

**New files:**
- `packages/directory/server.js` — Express server with /register, /heartbeat, /discover, /connect
- `packages/directory/registry.js` — In-memory agent registry + JSON persistence + offline detection
- `packages/directory/discovery.js` — Two-stage pipeline: index scoring + LLM reasoning
- `bin/directory.js` — CLI entry point for `nousync directory`

**Modified:**
- `bin/nousync.js` — Add `directory` subcommand
- `bin/serve.js` — Add directory registration + heartbeat loop
- `packages/agent/server.js` — Update imports from `packages/core/`
- `packages/core/paths.js` — Add `directoryDataDir()` path helper

## Open Questions

- None — ready for planning.

## Next Steps

-> `/workflows:plan` for implementation details

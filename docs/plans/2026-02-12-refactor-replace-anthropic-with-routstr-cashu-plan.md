---
title: Replace Anthropic SDK with Routstr + Unified Cashu Wallet
type: refactor
date: 2026-02-12
---

# Replace Anthropic SDK with Routstr + Unified Cashu Wallet

## Overview

Remove the Anthropic SDK dependency entirely and route all LLM inference through Routstr (`api.routstr.com`), paying per-request with Cashu ecash tokens. Unify the existing Cashu wallet so it powers everything: paying for LLM calls (distillation, indexing, synthesis, discovery), receiving payments from askers, and auto-paying when asking other agents. No API keys. Just a wallet.

## Problem Statement / Motivation

Currently nousync requires an `ANTHROPIC_API_KEY` — a centralized, KYC'd credential that ties every node to an Anthropic account. This contradicts the P2P, permissionless ethos of the project. Routstr provides OpenAI-compatible inference paid via Cashu ecash micropayments, meaning:

- **No accounts, no API keys, no KYC** — just fund a wallet with sats
- **Circular economy** — agents earn sats answering questions, spend sats on inference
- **Censorship resistant** — Routstr supports Tor, multiple mints, no identity required
- **Provider agnostic** — Routstr proxies 328+ models from all major providers

## Proposed Solution

### Architecture After Refactor

```
┌──────────────────────────────────────────────────────┐
│                  ~/.nousync/wallet.db                 │
│              (single Cashu wallet for all)            │
└──────────┬───────────┬───────────────┬───────────────┘
           │           │               │
     ┌─────▼─────┐ ┌──▼──────────┐ ┌──▼──────────────┐
     │  nousync   │ │  nousync    │ │  nousync        │
     │  init      │ │  serve      │ │  ask            │
     │            │ │             │ │                  │
     │ wallet.send│ │ wallet.recv │ │ wallet.send     │
     │ → Routstr  │ │ (from asker)│ │ → agent server  │
     │ for distill│ │ wallet.send │ │ (X-Cashu)       │
     │ & indexing │ │ → Routstr   │ │                  │
     └─────┬──────┘ │ for synth   │ └──────────────────┘
           │        └──────┬──────┘
           │               │
           ▼               ▼
    ┌──────────────────────────────┐
    │  Routstr (api.routstr.com)   │
    │  X-Cashu: token → inference  │
    │  X-Cashu: change ← response │
    └──────────────────────────────┘
```

### Payment Flow Per LLM Call

```
1. wallet.send(mintUrl, maxCost)  →  Cashu token
2. POST /v1/chat/completions
     Header: X-Cashu: <token>
3. Response arrives
     Header: X-Cashu: <change_token>   (may be absent if exact amount)
4. wallet.receive(changeToken)    →  unspent funds reclaimed
```

## Technical Approach

### Phase 1: Create Routstr LLM Client (`packages/core/llm.js`)

A thin wrapper that translates between the codebase's existing API patterns and the OpenAI-compatible format Routstr expects, while handling Cashu payment per-request.

**New file: `packages/core/llm.js`**

This module exports a `createLLMClient(wallet, config)` function that returns an object matching the injection interface already used throughout the codebase: `{ messages: { create(params) } }`.

Internally it:

1. **Translates tool definitions**: Anthropic `{ name, description, input_schema }` → OpenAI `{ type: 'function', function: { name, description, parameters } }`
2. **Translates request format**: Anthropic `messages.create({ model, max_tokens, system, tools, tool_choice, messages })` → OpenAI `chat.completions.create({ model, max_tokens, tools, tool_choice, messages })` with system prompt moved into messages array
3. **Translates tool_choice**: `{ type: 'tool', name: X }` → `{ type: 'function', function: { name: X } }`
4. **Handles payment**: Before each request, calls `wallet.send()` to mint a Cashu token, attaches as `X-Cashu` header. After response, parses `X-Cashu` response header for change and calls `wallet.receive()`.
5. **Translates response**: OpenAI `choices[0].message.tool_calls[0].function.arguments` (JSON string) → Anthropic-shaped `content: [{ type: 'tool_use', input: parsed }]` and `usage: { input_tokens, output_tokens }`

**Why maintain Anthropic response shape internally?** All 4 call sites + all 14 tests use `response.content.find(b => b.type === 'tool_use').input`. The translation layer means zero changes to distiller.js, index-builder.js, synthesizer.js, or discovery.js beyond swapping the client. Tests continue to work with existing mocks since the injection interface is unchanged.

**Payment details:**
- `maxCost` per request is configurable in config.yaml (e.g., `routstr.max_cost_sats: 50`)
- On insufficient wallet balance: throw descriptive error with current balance and required amount
- On missing change token: no-op (exact payment or Routstr consumed the full amount)
- On invalid change token: log warning, don't crash (funds lost but request succeeded)

```
// Conceptual interface — not literal code

createLLMClient(wallet, config) → {
  messages: {
    async create({ model, max_tokens, system?, tools, tool_choice, messages }) → {
      content: [{ type: 'tool_use', id, name, input }],
      usage: { input_tokens, output_tokens }
    }
  }
}
```

**File: `packages/core/llm.js`**

### Phase 2: Unify the Wallet (always-on)

Currently the wallet is only created when `config.payment?.enabled`. After this refactor, the wallet is always needed (for paying Routstr). Changes:

**`bin/serve.js`:**
- Always create wallet (remove `if (config.payment?.enabled)` guard)
- Create LLM client from wallet: `createLLMClient(wallet, config)`
- Pass LLM client to `createAgentServer()` instead of relying on Anthropic SDK auto-creation

**`bin/directory.js`:**
- Always create wallet
- Create LLM client from wallet
- Pass to `createDirectoryServer({ client: llmClient, ... })` (replaces `new Anthropic()`)

**`bin/init.js`:**
- Create wallet at startup (after ensuring `~/.nousync/` exists)
- Create LLM client from wallet
- Pass to `distill()` and `buildIndex()` as `options.client`
- Remove API key prompt entirely — replaced by wallet balance check
- New first step: check wallet balance, warn if zero with instructions to fund

**`packages/core/wallet.js`:**
- No structural changes needed. Already supports `send()`, `receive()`, `getBalances()`, `destroy()`

### Phase 3: Update Config & Paths

**`packages/core/paths.js`:**
- Remove `ensureApiKey()` function entirely
- Add `ensureWallet()` — checks wallet.db exists and has >0 balance, prints funding instructions if not

**`~/.nousync/config.yaml` changes:**
- Remove: `anthropic_api_key`
- Add: `routstr` section

```yaml
routstr:
  url: https://api.routstr.com/v1      # default, can be any Routstr node
  model: claude-sonnet-4.5              # OpenRouter model naming
  max_cost_sats: 50                     # max prepayment per LLM request

payment:
  enabled: true
  amount: 100                           # sats charged per question
  unit: sat
  mints:
    - https://mint.minibits.cash/Bitcoin
```

**Model ID mapping:**
- `claude-sonnet-4-5-20250929` → `claude-sonnet-4.5` (Routstr/OpenRouter naming)
- Configurable via `routstr.model` in config

### Phase 4: Update `nousync ask` to Auto-Pay from Wallet

**`bin/ask.js`:**
- On 402 response: instead of prompting user to paste a token, auto-pay from wallet
- Parse payment request to get required amount and accepted mints
- `wallet.send(mintUrl, amount)` → get token → retry request with `X-Cashu` header
- If wallet balance insufficient: print balance, required amount, and funding instructions
- Remove the interactive readline token-paste flow

**`packages/client/connector.js`:**
- Add optional `wallet` parameter to constructor
- `ask()` method: if 402 received and wallet available, auto-retry with payment
- If no wallet and 402: return `payment_required` as before (for programmatic callers)

### Phase 5: Swap Dependencies

**`package.json`:**
- Remove: `"@anthropic-ai/sdk": "^0.39.0"`
- Add: `"openai": "^4.x"` (or use raw `fetch` — see alternatives below)

**Decision: OpenAI SDK vs raw fetch?**

Using raw `fetch` is simpler for this use case because:
- We only use one endpoint (`/v1/chat/completions`)
- We need custom header handling (`X-Cashu` on request and response)
- The OpenAI SDK doesn't expose response headers easily
- Fewer dependencies

**Recommendation: Use raw `fetch`.** Node 22 has built-in fetch. No new dependency needed. The LLM client in `packages/core/llm.js` constructs the request manually and parses the response.

### Phase 6: Update Init Flow

**`bin/init.js` new flow:**

```
[1] Wallet
    Balance: 1,250 sats (mint.minibits.cash)
    ✓ Ready

[2] Scanning Claude Code transcripts
    ...

[3] Distilling 15 sessions
    ~8 min, pays Routstr per session (~2 sats each)
    Estimated cost: ~30 sats

    Proceed? [Y/n]
```

If wallet is empty:
```
[1] Wallet
    Balance: 0 sats

    Fund your wallet to get started:
      1. Get Cashu tokens from cashu.me or any Cashu wallet
         Accepted mints: mint.minibits.cash/Bitcoin
      2. Run: nousync wallet receive <cashu_token>
      3. Re-run: nousync init
```

### Phase 7: Update Tests

**Test mock interface stays the same.** The `createMockClient` pattern in tests already returns:
```js
{ messages: { create: async (params) => ({ content: [...], usage: {...} }) } }
```

Since `packages/core/llm.js` returns this same interface shape, existing test mocks continue to work — they inject a mock client that bypasses the LLM layer entirely. No test changes needed for the mock pattern itself.

**New tests to add:**
- `test/llm.test.js` — Tests the translation layer:
  - Anthropic tool format → OpenAI tool format conversion
  - System prompt moved to messages array
  - tool_choice format translation
  - Response translation (OpenAI → Anthropic shape)
  - X-Cashu header attachment and change collection
  - Insufficient balance error handling
  - Missing change token handling

**Tests to update:**
- `test/distiller.test.js` — Update `usage` field assertions (`prompt_tokens` → `input_tokens` mapping, already handled by llm.js)
- `test/paths.test.js` — Remove `ensureApiKey` tests, add wallet-related tests

## Acceptance Criteria

### Functional Requirements

- [ ] `nousync init` distills sessions by paying Routstr via Cashu (no API key needed)
- [ ] `nousync serve` synthesizes answers by paying Routstr, receives payments from askers
- [ ] `nousync ask` auto-pays from wallet on 402 (no manual token paste)
- [ ] `nousync directory` pays Routstr for LLM-powered discovery
- [ ] `nousync wallet balance` shows unified balance across all mints
- [ ] `nousync wallet receive <token>` funds the wallet
- [ ] `nousync wallet withdraw <amount>` extracts funds
- [ ] All 4 tool-calling sites work through Routstr (distill, index, synthesize, discover)
- [ ] Change tokens from Routstr are automatically reclaimed to wallet
- [ ] Clear error messages when wallet balance is insufficient

### Non-Functional Requirements

- [ ] No `ANTHROPIC_API_KEY` required anywhere
- [ ] No `@anthropic-ai/sdk` in package.json
- [ ] No new runtime dependencies (use built-in fetch)
- [ ] All existing tests pass (mock injection pattern preserved)
- [ ] New tests cover the LLM translation layer

## Dependencies & Prerequisites

- **Funded Cashu wallet** for testing. Get tokens from cashu.me using mint.minibits.cash/Bitcoin
- **Routstr API available** at api.routstr.com (no signup needed)
- Node.js 22 (already in flake.nix) for built-in fetch

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Routstr downtime | All LLM calls fail | Config supports custom node URL; users can self-host routstr-core |
| Double-proxy latency (Routstr→OpenRouter→Anthropic) | Slower inference | Acceptable for batch distillation; future: self-host with direct Anthropic upstream |
| Overpayment with no change returned | Sats lost | Log warnings; max_cost_sats caps exposure; Routstr protocol guarantees change |
| Model naming drift (OpenRouter IDs change) | Wrong model or 404 | Configurable model in config.yaml; `/v1/models` endpoint for validation |
| Wallet concurrency (serve handles multiple requests) | Double-spend or race | SQLite WAL mode + coco-cashu handles this; wallet.send() is atomic |
| Cashu mint unreachable | Can't create payment tokens | Multi-mint support; config accepts array of mints |

## Files Changed

### New
| File | Purpose |
|------|---------|
| `packages/core/llm.js` | Routstr LLM client with Cashu payment + format translation |
| `test/llm.test.js` | Tests for LLM translation layer |

### Modified
| File | Change |
|------|--------|
| `packages/core/distiller.js` | Remove `import Anthropic`; keep using injected client |
| `packages/core/index-builder.js` | Remove `import Anthropic`; keep using injected client |
| `packages/agent/synthesizer.js` | Remove `import Anthropic`; keep using injected client |
| `packages/directory/discovery.js` | No change (already receives injected client) |
| `packages/core/paths.js` | Remove `ensureApiKey()`; add wallet balance helpers |
| `packages/core/wallet.js` | No structural changes (already has send/receive/balance) |
| `bin/init.js` | Create wallet + LLM client; remove API key prompt; show cost estimates |
| `bin/serve.js` | Always create wallet; create LLM client; pass to server |
| `bin/directory.js` | Always create wallet; create LLM client; remove Anthropic import |
| `bin/ask.js` | Create wallet; auto-pay on 402 instead of interactive paste |
| `packages/client/connector.js` | Add optional wallet for auto-payment |
| `package.json` | Remove `@anthropic-ai/sdk` |
| `test/paths.test.js` | Remove ensureApiKey tests |

### Deleted
| Item | Reason |
|------|--------|
| `anthropic_api_key` in config.yaml | No longer needed |
| `ensureApiKey()` in paths.js | No longer needed |

## Implementation Order

1. `packages/core/llm.js` + `test/llm.test.js` — The translation layer (can be tested in isolation)
2. `packages/core/paths.js` — Remove ensureApiKey, add wallet helpers
3. `bin/init.js` — Wire up wallet + LLM client, remove API key flow
4. `bin/serve.js` — Wire up wallet + LLM client
5. `bin/directory.js` — Wire up wallet + LLM client
6. `bin/ask.js` + `packages/client/connector.js` — Auto-pay from wallet
7. `packages/core/distiller.js`, `index-builder.js`, `packages/agent/synthesizer.js` — Remove Anthropic imports (now dead code since client is always injected)
8. `package.json` — Remove `@anthropic-ai/sdk`
9. Update remaining tests

## References

- [Routstr Core](https://github.com/Routstr/routstr-core) — OpenAI-compatible proxy with Cashu payments
- [Routstr Protocol RIP-01](https://github.com/Routstr/protocol/blob/main/RIP-01.md) — Proxy/payments spec
- [Routstr Protocol RIP-03](https://github.com/Routstr/protocol/blob/main/RIP-03.md) — Client spec (OpenAI compatibility)
- [Routstr API](https://api.routstr.com/v1/info) — Live node info
- [Cashu NUT-18](https://github.com/cashubtc/nuts/blob/main/18.md) — Payment request encoding
- [coco-cashu-core](https://www.npmjs.com/package/coco-cashu-core) — Cashu wallet library (already in use)

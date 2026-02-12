# Nousphere Research Findings

Sprint 0 research to de-risk the two core unknowns: P2P tunneling via Holesail and Claude Code session data access.

## Gate Assessment

| Question | Answer | Confidence |
|----------|--------|------------|
| Can we tunnel HTTP over Holesail programmatically? | **YES** | Verified with working PoC |
| Can we access Claude Code session data? | **YES** | Direct JSONL file access confirmed |
| Do we need workarounds? | **No** | Both paths are clean, first-party APIs |

---

## 1. Holesail Programmatic API

### Package Info

- **npm**: `holesail` (v1.x)
- **License**: AGPL v3
- **Underlying stack**: HyperDHT (Holepunch), z32 encoding, hyper-cmd-lib-net

### Constructor

```js
const Holesail = require('holesail')

const hs = new Holesail(opts)
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `server` | boolean | `false` | Act as server (tunnel provider) |
| `client` | boolean | `false` | Act as client (tunnel consumer) |
| `key` | string | - | `hs://` URL or raw key. Required for client. Optional for server (creates deterministic seed) |
| `secure` | boolean | `false` | Enable secure mode (private firewall) |
| `port` | number | - | Local port to tunnel (server) or bind proxy to (client) |
| `host` | string | - | Host to tunnel. **Required for server** (validated in constructor) |
| `udp` | boolean | `false` | Force UDP protocol |
| `log` | boolean/number | `false` | Enable logging. `true` = INFO, `0` = DEBUG, `1-3` = levels |

**Validation constraints:**
- Cannot set both `server` and `client`
- Client requires `key` to be non-empty
- Server requires `host` to be specified

### Lifecycle

```js
// 1. Construct
const hs = new Holesail({ server: true, port: 3456, host: '127.0.0.1', secure: true })

// 2. Wait for ready (extends ReadyResource, calls _open() internally)
await hs.ready()

// 3. Use (tunnel is active)
console.log(hs.info)

// 4. Cleanup
await hs.close()
```

`ready()` calls `_open()` which:
- Creates `HolesailServer` or `HolesailClient` with a `HyperDHT` instance
- Generates keypair from seed (server) or decodes key (client)
- Calls `connect()` which starts listening (server) or creates TCP proxy (client)
- Server also `put()`s host info as a mutable DHT record, refreshed every 50 minutes

### `hs.info` Object

**Server info:**
```json
{
  "type": "server",
  "state": "listening",
  "secure": true,
  "port": 3456,
  "host": "127.0.0.1",
  "protocol": "tcp",
  "seed": "<hex>",
  "key": "<hex-or-z32>",
  "url": "hs://s000<key>",
  "publicKey": "<z32-encoded>"
}
```

**Client info:**
```json
{
  "type": "client",
  "state": "listening",
  "secure": true,
  "port": 4567,
  "host": "127.0.0.1",
  "protocol": "tcp",
  "key": "<key>",
  "publicKey": "<z32-encoded>"
}
```

### Key Format

- **Secure mode**: Key is 64 hex chars (random 32 bytes). URL prefix: `hs://s000`
- **Insecure mode**: Key is z32-encoded public key. URL prefix: `hs://0000`
- URL parser: `Holesail.urlParser(url)` returns `{ key, secure }`
- Minimum key length: 32 chars (enforced by CLI, not API)

### Connection Timing (from PoC)

| Metric | Value |
|--------|-------|
| Server ready time | ~1900ms |
| Client connection time | ~1100ms |
| First HTTP request through tunnel | ~590ms |
| Subsequent requests (warm) | **1-2ms** |

### Static Methods

- `Holesail.urlParser(url)` - Parse `hs://` URL into `{ key, secure }`
- `Holesail.lookup(url)` - Ping a Holesail server, returns DHT record data or null

### Pause/Resume

```js
await hs.pause()   // Suspends DHT
await hs.resume()  // Resumes DHT
```

### Error Handling

- Constructor throws synchronously on invalid options (via `validateOpts`)
- `ready()` rejects if DHT connection fails
- No event emitter pattern - errors surface through async/await
- `connect()` throws if already connected (`this.running` check)

### Gotchas

1. **Server requires `host`** - omitting it throws "No host specified". Always pass `host: '127.0.0.1'`
2. **Client defaults to port 8989** if no port specified and DHT record has no port
3. **AGPL v3 license** - copyleft implications if distributing
4. **DHT bootstrap time** - First connection takes ~1-2s. Subsequent connections are faster once DHT is warm
5. **No automatic reconnection** - If the DHT connection drops, you need to create a new instance

---

## 2. Claude Code Session Storage

### Storage Location

```
~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
```

Path encoding: absolute path with `/` replaced by `-`. Example:
```
/Users/claude/nousphere -> -Users-claude-nousphere
```

Subagent transcripts:
```
~/.claude/projects/<encoded-path>/<session-uuid>/subagents/agent-<agent-id>.jsonl
```

### File Format: JSONL

Each line is a self-contained JSON object. Key fields per line:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"user"`, `"assistant"`, `"progress"`, `"file-history-snapshot"` |
| `parentUuid` | string/null | Parent message ID (conversation threading) |
| `uuid` | string | This message's unique ID |
| `sessionId` | string | Session UUID |
| `timestamp` | ISO 8601 | When the message was recorded |
| `message.role` | string | `"user"` or `"assistant"` |
| `message.content` | array | Content blocks (text, tool_use, tool_result, thinking) |
| `isSidechain` | boolean | Whether this is a subagent message |
| `cwd` | string | Working directory at time of message |
| `version` | string | Claude Code version |

### Content Block Types

- **Text**: `{ "type": "text", "text": "..." }`
- **Tool use**: `{ "type": "tool_use", "id": "toolu_...", "name": "Bash", "input": {...} }`
- **Tool result**: `{ "type": "tool_result", "tool_use_id": "toolu_...", "content": "..." }`
- **Thinking**: `{ "type": "thinking", "thinking": "...", "signature": "..." }`

### Other Storage

| Path | Content |
|------|---------|
| `~/.claude/todos/<session>-agent-<id>.json` | Task lists per session |
| `~/.claude/file-history/<session>/<hash>@v<n>` | File edit history/undo |
| `~/.claude/debug/<session>.txt` | Debug logs |
| `~/.claude/plans/<slug>.md` | Cached plans |
| `~/.claude/settings.json` | Global settings + hooks |
| `~/.claude/settings.local.json` | Local-only settings |

### Programmatic Access

**Direct file read** - JSONL files are readable at any time, even during active sessions:
```js
const fs = require('fs')
const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n')
const messages = lines.map(l => JSON.parse(l))
```

**CLI output modes:**
```bash
claude -p "prompt" --output-format json        # Structured JSON output
claude -p "prompt" --output-format stream-json  # Streaming JSON events
claude --resume                                 # Resume most recent session
claude --continue                               # Continue last session
```

---

## 3. Claude Code Hooks System

### Available Hook Events

| Event | When | Can Block? | Key for Nousphere |
|-------|------|------------|-------------------|
| `SessionStart` | Session begins/resumes | No | Load context |
| `SessionEnd` | Session terminates | No | **Trigger share** |
| `Stop` | Claude finishes responding | **Yes** | Force session summary |
| `PreToolUse` | Before tool execution | Yes | Intercept/modify |
| `PostToolUse` | After tool succeeds | No | React to changes |
| `SubagentStart` | Subagent spawns | No | Track |
| `SubagentStop` | Subagent finishes | Yes | Track |
| `UserPromptSubmit` | User sends prompt | Yes | Inject context |
| `PreCompact` | Before compaction | No | Save state |

### Hook Input (stdin JSON)

Every hook receives these common fields on stdin:

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../<uuid>.jsonl",
  "cwd": "/Users/user/project",
  "permission_mode": "default",
  "hook_event_name": "SessionEnd"
}
```

**Critical field: `transcript_path`** - This gives every hook direct access to the full session transcript JSONL file.

### SessionEnd Hook (Primary Integration Point)

Receives `reason` field: `"clear"`, `"logout"`, `"prompt_input_exit"`, `"bypass_permissions_disabled"`, `"other"`.

Cannot block session termination but can:
- Read the full transcript via `transcript_path`
- Package and share the session data
- Write summary files
- Trigger external processes

### Stop Hook (Secondary Integration Point)

Can **block** Claude from stopping by returning:
```json
{ "decision": "block", "reason": "Please write a session summary first" }
```

This forces Claude to continue and execute the requested action before stopping.

### Hook Configuration (settings.json)

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/share-session.sh"
          }
        ]
      }
    ]
  }
}
```

### Skills Can Define Scoped Hooks

```yaml
---
name: share-session
description: Share current session via P2P tunnel
hooks:
  Stop:
    - hooks:
        - type: command
          command: "./scripts/share-session.sh"
---
```

### Environment Variables Available

- `$CLAUDE_PROJECT_DIR` - Project root
- `$CLAUDE_CODE_REMOTE` - "true" if remote web environment
- `$CLAUDE_ENV_FILE` - (SessionStart only) File path for persisting env vars

---

## 4. Architecture Implications for Nousphere

### Recommended Integration Path

```
SessionEnd hook
  -> reads transcript_path from stdin JSON
  -> starts Holesail server tunneling a local HTTP server
  -> HTTP server serves the session transcript
  -> prints connection URL to stderr (shown to user)
  -> optionally writes connection info to known file path
```

### Alternative: Stop Hook + CLAUDE.md

If we want Claude to generate a summary before sharing:

1. CLAUDE.md instruction: "Before ending, write session summary to `.nousphere/summary.md`"
2. Stop hook checks if summary exists, blocks if not
3. SessionEnd hook packages summary + transcript and shares via Holesail

### Key Design Decisions

1. **Use SessionEnd for sharing** - Clean, non-blocking, gets transcript_path directly
2. **Holesail secure mode** - Always use `secure: true` for encrypted tunnels
3. **Read JSONL directly** - No need for fallback; transcripts are always available
4. **Connection info file** - Write `hs://` URL to `~/.nousphere/connections/<session-id>.json`
5. **Persistent server** - Consider a long-running daemon vs. per-session server

### Latency Budget

| Step | Expected Time |
|------|--------------|
| SessionEnd hook fires | ~0ms |
| Read transcript | <50ms (file I/O) |
| Start Express server | <50ms |
| Start Holesail tunnel | ~2000ms |
| Total to shareable URL | **~2.1s** |

First HTTP request from consumer: ~1100ms connection + ~600ms first request = ~1.7s.
Subsequent requests: 1-2ms.

---

## 5. Proof of Concept Results

### spike/holesail-poc/

**server.mjs** - Express HTTP server exposed via Holesail tunnel
**client.mjs** - Connects to tunnel, makes requests, measures latency

### Test Results

```
Server ready:     1931ms
Client connected: 1138ms
First request:    593ms
Warm requests:    1-2ms avg
Tunnel verified:  YES (both / and /echo/:text endpoints)
```

### Verified Capabilities

- [x] Programmatic Holesail server creation
- [x] Programmatic Holesail client connection
- [x] HTTP request/response through tunnel
- [x] Secure mode key generation and exchange
- [x] Connection info serialization to file
- [x] Graceful shutdown

---

## 6. Gotchas and Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Holesail AGPL license | Medium | Only affects distribution; we're running locally |
| DHT bootstrap latency (~2s) | Low | Acceptable for session sharing use case |
| No Holesail reconnection | Medium | Create new instance on failure; sessions are short-lived |
| Session JSONL can be large | Low | Stream/paginate; most sessions are <10MB |
| Hook timeout (600s default) | Low | Sufficient for our use case; configurable |
| SessionEnd can't block | Low | Not needed - we just need to trigger sharing |
| Subagent transcripts separate | Low | Include subagent files from `<session>/subagents/` |

# Post-Parity Tracks

After Phase 7 parity, `boring-ui` has three intentional expansion tracks. These are
**not** migration blockers and they are **not** current production defaults.

This document is the source of truth for what these tracks mean now:
- what config shapes are reserved
- what the current code actually supports
- what must land before a track is considered real

The supported foundation profile today remains:

```toml
[workspace]
backend = "bwrap"

[agent]
runtime = "pi"
placement = "browser"
```

See [docs/runbooks/MODES_AND_PROFILES.md](../runbooks/MODES_AND_PROFILES.md) for
the live runtime matrix.

## Current Status Matrix

| Track | Intended config | Current reality | Hard constraints |
| --- | --- | --- | --- |
| JustBash browser backend | `workspace.backend = "justbash"` | Experimental design target only | Browser-only, no persistence, no real git/python |
| AI SDK runtime | `agent.runtime = "ai-sdk"` | Not supported; startup validation rejects it today | No runtime adapter, no server transport, no UI wiring |
| Server-side PI | `agent.runtime = "pi"` + `agent.placement = "server"` | Deferred; config path exists, runtime does not | Requires `workspace.backend = "bwrap"` and `DATABASE_URL` |

## Track 1: JustBash Browser Backend

**Status:** Experimental, browser-only

JustBash is the lightest-weight post-parity track. The intent is a zero-server,
zero-persistence browser workspace with a shell-like execution surface.

### Intended behavior

- File operations via in-memory filesystem
- Shell execution via JustBash WASM
- Instant startup, no workspace provisioning
- Useful for demos, tutorials, and disposable sandboxes

### Current contract

```toml
[workspace]
backend = "justbash"
```

The capability model for this backend is already defined in code:
- `workspace.files`
- `workspace.exec`

And explicitly absent:
- `workspace.git`
- `workspace.python`

The backend is browser-only. The server resolver rejects it for server-side use,
the same way it rejects `lightningfs`.

### Non-goals

- Persistent workspace storage
- Real git repos
- Python execution
- Hosted production replacement for `bwrap`

### What must exist before this track is "real"

- A frontend data provider implementation for JustBash
- Capability-gated UI behavior for missing git/python features
- A documented demo/local profile that does not imply persistence
- Focused tests proving the files/exec subset works end-to-end

## Track 2: AI SDK Runtime

**Status:** Future, not supported

This track would add a second agent runtime using Vercel AI SDK primitives instead
of PI browser runtime internals.

### Intended behavior

- Provider-pluggable chat runtime
- Streaming via AI SDK transport
- Shared tool schemas reused across runtimes
- Optional replacement or supplement for PI

### Reserved config

```toml
[agent]
runtime = "ai-sdk"
```

That config is reserved for the future but is **not valid today**. Startup
validation still rejects `agent.runtime = "ai-sdk"`.

### Why it is blocked

- No `src/front/providers/ai-sdk/` runtime adapter exists
- No shipped server transport for AI SDK streaming exists
- No AgentPanel variant is wired for AI SDK
- Runtime choice between PI and AI SDK has not been finalized

### What must exist before this track is "real"

- Config validation accepts `ai-sdk`
- Frontend adapter and panel wiring exist
- Shared tool schemas are bound to real AI SDK tool executors
- Streaming contract is documented and tested
- Operator guidance explains provider credentials and trust boundaries

## Track 3: Server-Side PI

**Status:** Deferred, architecture path reserved

This track keeps PI as the runtime but moves placement from browser to server.

### Intended behavior

- Conversation loop runs on the Node.js server
- Tool execution can call server-side workspace services directly
- Frontend becomes a thinner streaming/presentation client

### Reserved config

```toml
[agent]
runtime = "pi"
placement = "server"
```

### Current hard requirements

The config validator already enforces:
- `agent.placement = "server"` requires `workspace.backend = "bwrap"`
- `agent.placement = "server"` requires `DATABASE_URL`

That means server placement is never valid with:
- `workspace.backend = "lightningfs"`
- `workspace.backend = "justbash"`

### What does not exist yet

- A shipped in-process PI runtime entrypoint on the server
- Server-side PI tool wiring
- Browser/server streaming contract for this runtime
- Operational guidance for API-key handling and workspace state ownership

### What must exist before this track is "real"

- PI compatibility is proven in the Node.js server environment
- Server-side tool execution is wired against `bwrap`
- Streaming transport is implemented and smoke-tested
- Docs explain the security model for user-supplied model credentials

## Recommended Order

1. **JustBash**
   Lowest implementation cost and easiest to demo safely as an explicitly
   disposable browser-only profile.
2. **Server-side PI**
   Strongest architectural fit with the current server design, but only after
   PI compatibility and streaming details are proven.
3. **AI SDK**
   Highest scope and the most product-facing runtime decision. Treat it as a
   deliberate runtime strategy project, not a quick swap.

## Guardrails

- Do not present any of these tracks as shipped production defaults.
- Do not enable `ai-sdk` in app configs until validation and runtime wiring land.
- Do not imply `justbash` provides persistence or real git support.
- Do not treat server-side PI as available merely because `agent.placement` has a
  `server` enum value; the runtime path itself still needs implementation.

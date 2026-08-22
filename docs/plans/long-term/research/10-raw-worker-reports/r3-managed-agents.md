# Anthropic Managed Agents and Claude Agent SDK: technical analysis

**Documentation snapshot:** 2026-08-10. Managed Agents is a beta API and requires `anthropic-beta: managed-agents-2026-04-01` unless a feature-specific beta header replaces it. ([Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview), [API beta headers](https://platform.claude.com/docs/en/api/beta-headers))

## 1. What Managed Agents actually is

### Product and hosting model

- Managed Agents is Anthropic's server-hosted, configurable agent harness on the Claude Developer Platform. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview))

- Anthropic runs the model/tool loop, executes built-in tools, provisions the runtime, persists event history, checkpoints the sandbox, and performs context compaction and prompt caching. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview), [Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- The customer supplies an Agent definition, an Environment, a Session, user events, optional files/vaults, and any results or approvals required by custom tools. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview), [Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- The four core resources are `Agent`, `Environment`, `Session`, and `Event`. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview))

- An Agent is persisted configuration; an Environment is reusable sandbox configuration; a Session is a stateful execution/conversation; Events are its ordered inputs and outputs. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview))

- The API surface is REST resource management plus Server-Sent Events, not a long-running SDK process owned by the customer. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview), [Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

### Minimal managed request surface

```http
POST /v1/agents
POST /v1/environments
POST /v1/sessions
POST /v1/sessions/{session_id}/events
GET  /v1/sessions/{session_id}/events
GET  /v1/sessions/{session_id}/events/stream
```

Source: [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview), [Sessions](https://platform.claude.com/docs/en/managed-agents/sessions), [Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming).

- A session can start idle or start running when `initial_events` contains work. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- Posting a user event persists it; when the event represents work and the session can proceed, Anthropic schedules and runs the loop. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Results are persisted agent/span/session events; the client can list them or stream them with SSE. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- A successful turn normally returns the session to `idle`; `terminated` means the session is permanently ended, not merely that a turn finished. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

### Managed Agents versus self-hosting Claude Agent SDK

| Concern | Managed Agents | Claude Agent SDK |
|---|---|---|
| Loop owner | Anthropic service | Customer's Python/TypeScript process |
| Runtime | Anthropic cloud sandbox, or customer worker in self-hosted-sandbox mode | Customer machine/container |
| API shape | REST resources + SSE | `query()` / `ClaudeSDKClient` async message iterator |
| Conversation history | Server-persisted Session events | Local JSONL by default; optional `SessionStore` mirror |
| Filesystem continuity | Managed checkpoint, limited to 30 days from sandbox creation | Whatever customer hosting preserves |
| Built-in tools | Declared in Agent and run in session sandbox | Enabled in SDK options and run by Claude Code subprocess |
| Custom tools | Declare schema; client answers `agent.custom_tool_use` | In-process MCP handler can auto-dispatch |
| Configuration | Persisted and versioned Agent | Per-call `ClaudeAgentOptions` / `Options` and filesystem settings |
| Operations | Anthropic schedules, reschedules, and meters runtime | Customer builds queues, workers, recovery, isolation, and scaling |

Sources: [Migration guide](https://platform.claude.com/docs/en/managed-agents/migration), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage).

- Managed Agents is a separate hosted product, not merely the Agent SDK wrapped in an HTTP endpoint. ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview))

- The SDK is appropriate when the customer needs custom loop-adjacent hooks, local execution, arbitrary hosting, or direct control of the process lifecycle. ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting))

- Managed Agents removes the need to keep an SDK worker alive, but custom-tool completions and external product orchestration still belong to the customer. ([Migration guide](https://platform.claude.com/docs/en/managed-agents/migration))

## 2. Agent definition

### Managed Agent configuration

```json
{
  "name": "support-agent",
  "description": "Handles support investigations",
  "model": "claude-sonnet-5-20260203",
  "system": "Investigate carefully and cite evidence.",
  "tools": [],
  "mcp_servers": [],
  "skills": [],
  "multiagent": null,
  "metadata": {"team": "support"}
}
```

Source and field semantics: [Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup).

- `name` and `model` are required on creation. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

- `description`, `system`, `tools`, `mcp_servers`, `skills`, `multiagent`, and `metadata` are configuration fields. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

- Managed Agents supports Claude 4.5 and newer model families. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

- `model` may be a model ID string or an object that additionally selects `speed`, `effort`, and `inference_geo`. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

- Exact allowed values are model-dependent; using a value unsupported by the selected model is an API validation concern. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup), [Models](https://platform.claude.com/docs/en/about-claude/models/overview))

### Versioning and updates

- Changing versioned Agent configuration creates a new immutable Agent version. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

- An update can include the currently observed `version` for optimistic concurrency. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

- If that version no longer matches, the update returns HTTP `409`, even if the requested field values happen to match current values. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

- Omitting the version performs an unconditional update with last-write-wins behavior. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

- Agent versions can be listed and sessions can pin a specific version. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup), [Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- A coordinator roster pins referenced Agent versions when the coordinator is created or updated. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- Archiving an Agent is irreversible and prevents new sessions; existing sessions continue against their resolved snapshot. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

### Session binding and overrides

```json
{"agent":"agent_123"}
```

```json
{"agent":{"type":"agent","id":"agent_123","version":7}}
```

```json
{
  "agent": {
    "type": "agent_with_overrides",
    "id": "agent_123",
    "version": 7,
    "model": "claude-opus-5-20260401",
    "system": "Session-specific instructions",
    "tools": [],
    "mcp_servers": [],
    "skills": []
  }
}
```

Source: [Sessions](https://platform.claude.com/docs/en/managed-agents/sessions).

- A bare Agent ID resolves the latest version when the session is created. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- A pinned reference resolves exactly the specified version. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- Session overrides may replace `model`, `system`, `tools`, `mcp_servers`, and `skills`; they do not create a new Agent version. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- Override arrays replace the corresponding Agent array in full; they do not merge. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- `null` clears an overridable field except `model`, which cannot be cleared. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- Tools cannot be cleared while non-empty skills require them, and MCP configuration cannot be cleared while still referenced. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- The Session response contains the fully resolved Agent snapshot used for that session. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- While idle, only the resolved Agent's `tools` and `mcp_servers` can be replaced mid-session. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- The session's model, base system prompt, and skills remain fixed after creation. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- `system.message` appends system-level context during a session on supported models; it does not mutate the Agent's `system` field. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- The documented supported models for `system.message` are Opus 4.8, Fable 5, Mythos 5, and Opus 5. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

### Agent SDK comparison

- SDK options are normally supplied per `query()` call rather than stored as a platform Agent resource. ([Migration guide](https://platform.claude.com/docs/en/managed-agents/migration))

- With no `systemPrompt` / `system_prompt`, the SDK uses a minimal tool-calling prompt, not the full Claude Code prompt. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

- The full Claude Code prompt is selected with `{type:"preset", preset:"claude_code"}`. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

- The preset object supports `append`; a string replaces the default prompt completely. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

- Project and user `CLAUDE.md` contents are injected as conversation context when the matching `settingSources` are enabled; they are not part of the system prompt. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

- SDK configuration versioning is the customer's code/configuration-management responsibility; the SDK docs define no Agent-version resource. ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview))

## 3. Sessions and conversations

### Identity and lifecycle

- A Managed Session has a server-assigned `session_*` identity and a resolved Agent snapshot. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- Session states are `idle`, `running`, `rescheduling`, and `terminated`. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- `idle` is resumable and can mean new, turn-complete, interrupted, or waiting for required action. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations), [Tool confirmations](https://platform.claude.com/docs/en/managed-agents/tool-confirmations))

- `running` means the service is actively processing the session. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- `rescheduling` means the service is recovering from a transient execution failure. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- `terminated` is final; no more events can continue the session. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

### Creation limits

- `initial_events` accepts at most 50 events. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- Creation-time initial events may contain `user.message` and at most one `user.define_outcome`. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- A non-empty initial work sequence can make the new Session immediately `running`. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- A session creation request can reference at most 100 document blocks sourced from Files. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- The documented request-body maximum is 32 MB. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- Initial-event validation is atomic: a failure rejects the creation rather than partially applying events. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

### Persistence, resume, retention, deletion

- Managed event history remains server-persisted until the Session is explicitly deleted. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming), [Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- Posting a new user event to an idle Session resumes work against the persisted conversation. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Archiving blocks new work but preserves the Session record and event history. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- A running Session must be interrupted before it can be archived or deleted. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- Deletion removes the Session record, its events, its sandbox checkpoint, and files produced by the Session. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- Deletion does not delete independent Environments, Agents, Skills, Vaults, memories, or user-uploaded Files. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- Lists use cursor pagination. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

- The conversation record and sandbox have different retention semantics: events persist until deletion, while sandbox state expires 30 days after sandbox creation. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Sandbox activity does not extend that 30-day deadline. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Resuming after sandbox expiry uses a fresh sandbox while retaining the persisted conversation events. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

### Agent SDK sessions

- An SDK session records conversation messages, tool calls/results, and responses; it does not itself snapshot the working filesystem. ([SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions))

- `continue` resumes the most recent session associated with the working directory. ([SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions))

- `resume` takes a known session UUID. ([SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions))

- Forking starts a new session ID with copied history and leaves the original conversation unchanged. ([SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions))

- A fork still shares the real filesystem unless the customer provides filesystem isolation or uses checkpoint/rewind features. ([SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions))

- Default transcripts are JSONL under `~/.claude/projects/`. ([Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage))

- TypeScript can set `persistSession:false`; Python can use `CLAUDE_CODE_SKIP_PROMPT_HISTORY` to avoid the default disk transcript. ([SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions))

- `SessionStore` can mirror transcripts into S3, Redis, a database, or another customer adapter. ([Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage))

- The store requires `append` and `load`; listing, deletion, and subkey operations are optional. ([Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage))

- The external store is a mirror, not a replacement: the SDK writes locally first. ([Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage))

- Mirror appends retry up to three times except timeout failures, then emit `system/mirror_error`, drop that batch, and allow the query to continue. ([Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage))

- Adapters should deduplicate entries by `entry.uuid`. ([Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage))

- External retention is adapter-defined; local `cleanupPeriodDays` is independent. ([Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage))

## 4. Durability

### Interruptions and recovery

- A Managed Session can receive `user.interrupt`; the service stops current work and returns it to `idle`. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- A normal interruption is not represented by a unique model `stop_reason`; the docs describe `end_turn` for the resulting idle transition. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- Completed events and conversation history already persisted remain available after interruption. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Sandbox state is checkpointed while idle, subject to the fixed 30-day sandbox lifetime. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Transient infrastructure failures can move a Session to `rescheduling`, after which Managed Agents retries execution. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- Retry count, retry backoff, retry eligibility matrix, and exactly-once guarantees for `rescheduling`: **UNVERIFIED; the public docs do not specify them.** ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- Generic request idempotency keys for Agent, Environment, Session, or Event creation: **UNVERIFIED; no idempotency-key parameter is documented on the reviewed pages.** ([Managed Agents API reference](https://platform.claude.com/docs/en/api/managed-agents))

- Exactly-once custom-tool execution across network failures: **UNVERIFIED; customers should treat external side effects as retryable/duplicable unless their own protocol prevents duplication.** ([Custom tools](https://platform.claude.com/docs/en/managed-agents/custom-tools))

### Submission or settlement

- Managed Agents has no documented generic submission/commit/settlement transaction for arbitrary agent work. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview))

- `user.define_outcome` is an optional goal-and-grader loop, not a durable side-effect settlement primitive. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- An outcome includes a natural-language `description`, a rubric supplied as text or file, and `max_iterations`. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- `max_iterations` defaults to 3 and may be at most 20. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- Grading runs in a separate grader context. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- Evaluation emits `span.outcome_evaluation_start`, `span.outcome_evaluation_ongoing`, and `span.outcome_evaluation_end`. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- Documented terminal/evaluation results are `satisfied`, `needs_revision`, `max_iterations_reached`, `failed`, and `interrupted`. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- `needs_revision` returns feedback to the agent and continues the loop; satisfied or failed evaluations return idle. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- Deliverables are conventionally written to `/mnt/session/outputs`; this does not imply transactional publication to an external system. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

### Webhook durability

- Webhooks are notifications, not a durable event log; recipients should fetch authoritative Session state/events after notification. ([Webhooks](https://platform.claude.com/docs/en/managed-agents/webhooks))

- Delivery order is not guaranteed. ([Webhooks](https://platform.claude.com/docs/en/managed-agents/webhooks))

- Duplicate webhook deliveries retain the same event ID, enabling consumer deduplication. ([Webhooks](https://platform.claude.com/docs/en/managed-agents/webhooks))

- Delivery retries up to three attempts with jittered exponential delays from 5 to 120 seconds, then drops the notification. ([Webhooks](https://platform.claude.com/docs/en/managed-agents/webhooks))

- There is no separate durable “notification lost” signal after final drop. ([Webhooks](https://platform.claude.com/docs/en/managed-agents/webhooks))

- A `3xx` response disables the webhook rather than being followed as a redirect. ([Webhooks](https://platform.claude.com/docs/en/managed-agents/webhooks))

- Scheduled deployment triggers missed while unavailable are not backfilled. ([Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments))

- A scheduled Session creation rate-limit failure is recorded without retry, and the deployment waits for the next schedule. ([Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments))

## 5. The managed sandbox

### Isolation and filesystem

- Each cloud Session receives its own fresh Linux container; Sessions do not share a filesystem. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- The reference cloud image is Ubuntu 22.04 on x86-64. ([Cloud sandboxes reference](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference))

- Documented capacity is up to 8 GB RAM and 10 GB disk per sandbox. ([Cloud sandboxes reference](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference))

- Agent work occurs under `/workspace`. ([Migration guide](https://platform.claude.com/docs/en/managed-agents/migration))

- User-mounted uploads are read-only under `/mnt/session/uploads`. ([Files](https://platform.claude.com/docs/en/managed-agents/files))

- Intended deliverables go under `/mnt/session/outputs`. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- A Session can mount at most 500 Files. ([Files](https://platform.claude.com/docs/en/managed-agents/files))

- Mounted resources can be added or removed during a running Session through resource operations. ([Files](https://platform.claude.com/docs/en/managed-agents/files))

### Lifecycle and persistence

- An Environment is reusable configuration, not a shared running container. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- Environment package selections are cached for Sessions that use the Environment, then installed into each isolated sandbox. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- Environment configuration is not versioned. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- Idle sandbox state includes filesystem changes, installed packages, and generated files. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- That state is checkpointed for at most 30 days from sandbox creation, regardless of subsequent activity. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- After expiry, conversation history survives but the next turn receives a fresh sandbox. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Maximum continuous active-turn wall-clock timeout: **UNVERIFIED; no numeric maximum was found in the reviewed cloud sandbox or pricing docs.** ([Cloud sandboxes reference](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

### Network egress

- Cloud Environment networking defaults to unrestricted outbound access, subject to Anthropic's safety blocklist. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- A limited network policy accepts bare hosts and wildcard hosts in `allowed_hosts`. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- Under limited networking, `allow_mcp_servers` defaults to `false`. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- Under limited networking, `allow_package_managers` defaults to `false`. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- `web_search` and `web_fetch` domain behavior is separate from sandbox network policy. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- Anthropic recommends limited networking for production deployments. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

### Packages and preinstalled software

- Configurable package-manager order is apt, Cargo, RubyGems, Go, npm, then pip. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- Package versions can be pinned; omitting a version selects the current/latest resolvable package at build time. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- Preinstalled runtimes include Python 3.12+, Node.js 20+, Go 1.22+, Rust 1.77+, Java 21+, Ruby 3.3+, PHP 8.3+, and GCC 13+. ([Cloud sandboxes reference](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference))

- Preinstalled utilities include Git, curl, wget, jq, tar, zip, SSH/SCP, tmux, screen, make, CMake, ripgrep, tree, htop, sed, awk, grep, Vim, nano, diff, and patch. ([Cloud sandboxes reference](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference))

- SQLite and clients including `psql` and `redis-cli` are present. ([Cloud sandboxes reference](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference))

- Docker is present with documented limitations; it should not be treated as equivalent to an unrestricted privileged daemon. ([Cloud sandboxes reference](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference))

### Self-hosted sandbox variant

- Self-hosted sandboxes retain Anthropic orchestration while tool execution, filesystem, processes, and network run on a customer worker. ([Self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes))

- Tool inputs and outputs still pass through the Anthropic control plane. ([Self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes))

- The worker's work-directory guard protects file tools but is not a security boundary for unrestricted Bash. ([Self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes))

- The reference worker default maximum idle period is 60 seconds. ([Self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes))

## 6. Tools

### Managed built-ins

- The documented Managed Agent toolset contains `bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, and `web_search`. ([Tools](https://platform.claude.com/docs/en/managed-agents/tools))

- `computer` / computer use is not listed as a Managed Agent built-in on the reviewed toolset page: **UNVERIFIED as a Managed Agents capability.** ([Tools](https://platform.claude.com/docs/en/managed-agents/tools))

- A separate first-class `code_execution` tool is not listed; code can be executed through `bash`: **UNVERIFIED as a distinct Managed Agents tool.** ([Tools](https://platform.claude.com/docs/en/managed-agents/tools))

```json
{
  "type": "agent_toolset_20260401",
  "default_config": {"enabled": false},
  "configs": [
    {"name": "bash", "enabled": true},
    {"name": "read", "enabled": true},
    {"name": "write", "enabled": true}
  ]
}
```

Source: [Tools](https://platform.claude.com/docs/en/managed-agents/tools).

- Tool output above 100,000 characters, approximately 25,000 tokens, spills to a file; Claude receives a truncated preview and file path. ([Tools](https://platform.claude.com/docs/en/managed-agents/tools))

- Permission policy supports `always_allow` and `always_ask`, including per-tool overrides. ([Tool confirmations](https://platform.claude.com/docs/en/managed-agents/tool-confirmations))

- The Agent toolset defaults to allow, while MCP tools default to ask. ([Tool confirmations](https://platform.claude.com/docs/en/managed-agents/tool-confirmations))

### Managed custom tools

```json
{
  "type": "custom",
  "name": "lookup_order",
  "description": "Look up an order by ID",
  "input_schema": {
    "type": "object",
    "properties": {"order_id": {"type": "string"}},
    "required": ["order_id"]
  }
}
```

Source: [Custom tools](https://platform.claude.com/docs/en/managed-agents/custom-tools).

- Managed Agents emits `agent.custom_tool_use` with the tool name, generated input, and a tool-use ID. ([Custom tools](https://platform.claude.com/docs/en/managed-agents/custom-tools))

- The Session becomes idle with `requires_action` until required external results arrive. ([Custom tools](https://platform.claude.com/docs/en/managed-agents/custom-tools))

```json
{
  "type": "user.custom_tool_result",
  "custom_tool_use_id": "toolu_123",
  "content": [{"type": "text", "text": "Order shipped"}]
}
```

Source: [Custom tools](https://platform.claude.com/docs/en/managed-agents/custom-tools).

- When several custom tool uses block the Session, the client must resolve all required actions before execution resumes. ([Custom tools](https://platform.claude.com/docs/en/managed-agents/custom-tools))

- The Managed docs do not promise ordering or concurrency semantics for built-in tool execution: **UNVERIFIED.** ([Tools](https://platform.claude.com/docs/en/managed-agents/tools))

- Confirmation requests use `agent.tool_use` or `agent.mcp_tool_use`, then accept `user.tool_confirmation` with `result: "allow"` or `"deny"` and optional `deny_message`. ([Tool confirmations](https://platform.claude.com/docs/en/managed-agents/tool-confirmations))

### Messages API tool-use wire format

```json
{
  "type": "tool_use",
  "id": "toolu_01A",
  "name": "get_weather",
  "input": {"location": "Paris"}
}
```

- Client tools are declared in the request as `{name, description, input_schema, strict?}`. ([Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview))

- Claude returns one or more `tool_use` content blocks and normally `stop_reason: "tool_use"`. ([Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview))

- The caller appends the entire assistant response, then an immediate user message containing matching `tool_result` blocks. ([Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls))

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01A",
  "content": "18 C and clear",
  "is_error": false
}
```

- Error results set `is_error: true`; result content may be text or supported text/image/document/search-result blocks. ([Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls))

- When Claude returns several tool calls, the API specifies no execution order; the caller may run them concurrently and return all results in one user message. ([Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use))

- `tool_choice.disable_parallel_tool_use: true` prevents parallel calls in the Messages API. ([Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use))

### Agent SDK execution

- The SDK runs read-only built-ins and read-only-annotated MCP tools in parallel; Edit, Write, Bash, and other stateful operations are sequential. ([Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop))

- SDK custom tools are in-process MCP tools created with Python `@tool` / TypeScript `tool()`, bundled with `create_sdk_mcp_server` / `createSdkMcpServer`. ([Custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools))

- `readOnlyHint:true` allows safe parallel scheduling; without that hint custom tools execute sequentially. ([Custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools))

- A handler can return `isError:true`, images/resources, or `structuredContent`. ([Custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools))

- Tool Search is on by default for SDK MCP tools and defers full schemas until needed. ([Custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools))

## 7. MCP

### Managed outbound connector

```json
{
  "mcp_servers": [
    {"type": "url", "name": "crm", "url": "https://mcp.example.com/mcp"}
  ],
  "tools": [
    {"type": "mcp_toolset", "mcp_server_name": "crm"}
  ]
}
```

Source: [Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector).

- Managed Agents connects outbound to remote MCP servers over Streamable HTTP, with deprecated SSE fallback. ([Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector))

- Each configured MCP server must have a matching `mcp_toolset`, and each toolset must reference a configured server. ([Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector))

- The maximum is 20 MCP servers per Agent. ([Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector))

- MCP names are 1–255 characters and URLs are at most 2,048 characters. ([Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector))

- Toolset configuration can allow or deny named tools and apply a default permission policy. ([Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector))

- Private MCP endpoints can be reached through Anthropic's MCP tunnel mechanism. ([MCP tunnels](https://platform.claude.com/docs/en/managed-agents/mcp-tunnels))

### Authentication

- MCP credentials are supplied through a Session Vault rather than embedded into the Agent definition. ([Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

- Vault credential categories are `mcp_oauth`, `static_bearer`, and `environment_variable`. ([Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

- MCP credentials are keyed to the server URL. ([Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

- OAuth refresh is managed when the credential contains the needed refresh information. ([Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

- A Vault holds at most 20 credentials. ([Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

- Vaults are workspace-scoped; any API key in the same workspace can use them. ([Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

- Threads in a Session share its mounted Vaults. ([Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

### Inbound/server-side story

- Managed Agents documents an outbound MCP client/connector and private-network tunnel. ([Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector), [MCP tunnels](https://platform.claude.com/docs/en/managed-agents/mcp-tunnels))

- A first-class endpoint that exposes a Managed Agent itself as an inbound MCP server is **UNVERIFIED; it is not documented on the reviewed Managed Agents MCP pages.** ([Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector))

### Agent SDK overlap

- SDK `mcpServers` supports local stdio processes, remote HTTP, remote SSE, and in-process SDK MCP servers. ([SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp))

- Programmatic HTTP uses `type:"http"`; JSON config also accepts `streamable-http` as an alias. ([SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp))

- HTTP/SSE authentication can be supplied through headers; stdio credentials can be supplied through the child process `env`. ([SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp))

- SDK tool names use `mcp__{server}__{tool}` and can be allowed with exact names or wildcards. ([SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp))

- Because the SDK process is customer-hosted, its MCP servers and credentials inherit the customer's process/network isolation responsibilities. ([SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp), [Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment))

## 8. Skills / Agent Skills

### Format and lifecycle

- An Agent Skill is a directory containing `SKILL.md` plus optional references, scripts, templates, or other resources. ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

- `SKILL.md` combines YAML metadata with Markdown instructions. ([Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices))

- `name` and `description` metadata tell Claude what the Skill is and when it should be invoked. ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

- Managed custom Skills can be uploaded as an archive or as individual files and receive a `skill_*` identity and versions. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

```json
{"type":"custom","skill_id":"skill_123","version":4}
```

- Omitting a custom Skill version resolves the latest available version when configuration is resolved. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

- Managed Agents also supports Anthropic Skill references with `type:"anthropic"`. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

- Anthropic's documented prebuilt document Skills cover PowerPoint, Excel, Word, and PDF workflows. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

- A Session supports up to 500 distinct Skills after deduplication across its Agents. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

### Discovery

- A GitHub repository mounted as a Managed Session resource is scanned once at Session start for `.claude/skills/<name>/SKILL.md`. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

- Discovery is exactly one directory level under `.claude/skills`. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

- Commits added after Session start are not discovered by that Session. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

- Repository Skill discovery is unavailable for self-hosted sandboxes because that mode does not support the same GitHub repository resource. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

- Skill bundles are executable/trusted content; repository contributors can change instructions and scripts, so pinning and review are part of the security boundary. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

### Progressive disclosure

- Level 1 loads each Skill's name and description at startup, approximately 100 tokens per Skill. ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

- Level 2 loads the `SKILL.md` body only when Claude triggers the Skill; the guidance recommends keeping it under 5,000 tokens. ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

- Level 3 loads referenced resources only as needed. ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

- Scripts can execute through Bash so only their output, rather than their source, must enter model context. ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

- This staged loading is the core progressive-disclosure mechanism. ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

### agentskills.io relationship

- Claude Code documentation states that its Skills follow the open Agent Skills standard, which works across multiple AI tools. ([Claude Code Skills](https://code.claude.com/docs/en/slash-commands))

- Claude Code extends that standard with invocation control, subagent execution, and dynamic context injection. ([Claude Code Skills](https://code.claude.com/docs/en/slash-commands))

- The reviewed Anthropic pages do not explicitly name `agentskills.io`; the assertion that every Managed Agent extension is exactly compatible with a particular `agentskills.io` revision is **UNVERIFIED.** ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview), [Claude Code Skills](https://code.claude.com/docs/en/slash-commands))

### Agent SDK overlap

- SDK Skills are filesystem artifacts, not programmatically registered definitions. ([SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills))

- Default discovery covers `~/.claude/skills/`, `<cwd>/.claude/skills/`, and parent project directories up to the repository root. ([SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills))

- Discovery depends on `user` and `project` setting sources. ([SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills))

- The `skills` option accepts omitted/default, `"all"`, an allowlist of names, or `[]` to disable all. ([SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills))

- A Skills allowlist is a model-context filter, not a filesystem sandbox; Read or Bash can still reach files unless separately restricted. ([SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills))

## 9. Subagents / multi-agent

### Managed first-class coordinator

```json
{
  "multiagent": {
    "type": "coordinator",
    "agents": [
      {"type": "agent", "id": "agent_research", "version": 3},
      {"type": "self"},
      {"type": "advisor", "model": "claude-opus-5-20260401"}
    ]
  }
}
```

Source: [Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration).

- A coordinator may delegate to registered Agents, a fresh instance of itself, or an advisor model. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- The roster allows at most 20 unique entries. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- Delegation is limited to one level; child Agents do not recursively delegate. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- A Session permits at most 25 concurrent agent threads, excluding advisor calls. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- Threads share the Session sandbox, filesystem, and Vaults. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- Threads have isolated model context and separate event histories. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- Threads persist and can receive follow-up work. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- Delegated Agents retain their own model, prompt, tools, MCP, and Skills configuration. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- The coordinator can dispatch independent delegations in parallel. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- The primary Session stream exposes a condensed coordination view; a child thread endpoint exposes that thread's full history. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

### Agent SDK subagents

- SDK subagents are separate agent instances with isolated context, invoked through the `Agent` tool. ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents))

- They can be programmatic `agents` definitions, `.claude/agents/*.md` files, or the built-in `general-purpose` subagent. ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents))

- `AgentDefinition` requires `description` and `prompt`. ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents))

- Optional fields include `tools`, `disallowedTools`, `model`, `skills`, `memory`, `mcpServers`, `initialPrompt`, `maxTurns`, `background`, and `effort`. ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents))

- The main agent may invoke multiple subagents in parallel. ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents))

- Subagent transcripts persist separately from the main transcript and survive main-context compaction. ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents))

- A subagent can be resumed by preserving the main Session ID and subagent Agent ID. ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents))

- SDK subagent transcript cleanup defaults to 30 days through `cleanupPeriodDays`. ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents))

- A documented SDK-wide maximum concurrent-subagent number was not found on the reviewed page: **UNVERIFIED.** ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents))

## 10. Streaming

### Managed wire protocol

```http
GET /v1/sessions/{session_id}/events/stream
Accept: text/event-stream
anthropic-beta: managed-agents-2026-04-01
```

Source: [Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming).

- A thread can be streamed at `/v1/sessions/{session_id}/threads/{thread_id}/stream`. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Persisted event families include user inputs, system inputs, session events, span events, and agent events. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Persisted events have server identity/order metadata and `processed_at` once processed. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- By default, `agent.message` is emitted as a complete buffered event after the model request. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- `event_deltas[]=agent.message` opts into message deltas; `event_deltas[]=agent.thinking` opts into thinking preview events. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- The query accepts at most 100 `event_deltas[]` parameters. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Delta streaming adds stream-only `event_start` and `event_delta` records. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- A message `event_delta` contains a `content_delta`; event IDs correlate the preview with the final persisted event. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Delta previews are best-effort prefixes; the buffered persisted event is authoritative. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- `agent.thinking` produces `event_start` but no incremental thinking deltas. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

### Reconnect behavior

- Stream-only deltas are not persisted or replayed after disconnect. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- A reconnecting client reopens SSE and lists persisted events to recover authoritative completed state. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Text between the last received delta and the final buffered event cannot be reconstructed as its original delta sequence; only the final event can be recovered. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- A documented `Last-Event-ID` replay contract for stream deltas is **UNVERIFIED.** ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

### Agent SDK stream

- `query()` returns an asynchronous iterator of typed SDK messages; it is not an externally resumable SSE protocol. ([Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output))

- The stream includes a system initialization message, assistant messages, user/tool-result messages, and a final result message. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

- `includePartialMessages:true` / `include_partial_messages=True` emits raw Claude API stream events. ([Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output))

- TypeScript identifies these as `type:"stream_event"`; Python uses `StreamEvent`. ([Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output))

- Each partial message includes `uuid`, `session_id`, raw `event`, and `parent_tool_use_id`. ([Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output))

- The application must accumulate `content_block_delta` values itself. ([Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output))

- Resume after process/network disconnect depends on the Session transcript and a new `query(..., resume: session_id)` call; raw partial deltas are not documented as replayable. ([SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output))

## 11. Observability

### Managed usage and event surfaces

- Session usage reports input and output tokens. ([Usage and costs](https://platform.claude.com/docs/en/managed-agents/usage-and-costs))

- It separately reports cache-read input and cache-creation input, including 5-minute and 1-hour creation buckets. ([Usage and costs](https://platform.claude.com/docs/en/managed-agents/usage-and-costs))

- It reports `list_cost` as a currency amount, active sandbox seconds, and server-tool counts such as web-search and web-fetch requests. ([Usage and costs](https://platform.claude.com/docs/en/managed-agents/usage-and-costs))

- `session.usage` events are emitted before idle transitions and can be read from history. ([Usage and costs](https://platform.claude.com/docs/en/managed-agents/usage-and-costs))

- Span events expose model-request and outcome-evaluation lifecycle boundaries. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming), [Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- Session and thread event history is the principal audit/debug surface. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- Webhooks expose major lifecycle transitions but contain identifiers/type rather than a complete durable payload. ([Webhooks](https://platform.claude.com/docs/en/managed-agents/webhooks))

- A Managed Agents OpenTelemetry export, customer-defined trace propagation, or direct log-drain endpoint is **UNVERIFIED; none is documented on the reviewed Managed observability pages.** ([Usage and costs](https://platform.claude.com/docs/en/managed-agents/usage-and-costs), [Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

### Agent SDK telemetry

- SDK result messages expose `total_cost_usd`, cumulative usage, and per-model `modelUsage` / `model_usage`. ([Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking))

- `usage` excludes subagent consumption; `total_cost_usd` and `modelUsage` include the full subagent tree. ([Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking))

- SDK cost values are local estimates based on a bundled price table, not authoritative billing. ([Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking))

- Authoritative financial reporting comes from the platform Usage and Cost API or Console. ([Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking))

- OpenTelemetry is disabled until `CLAUDE_CODE_ENABLE_TELEMETRY=1` and an exporter are configured. ([SDK observability](https://code.claude.com/docs/en/agent-sdk/observability))

- Metrics cover tokens, cost, sessions, lines of code, and tool decisions. ([SDK observability](https://code.claude.com/docs/en/agent-sdk/observability))

- Log events cover prompts, API requests/errors, and tool results. ([SDK observability](https://code.claude.com/docs/en/agent-sdk/observability))

- Beta traces cover interactions, model requests, tool calls, and hooks; they additionally require `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`. ([SDK observability](https://code.claude.com/docs/en/agent-sdk/observability))

- OTLP is the supported SDK exporter path; the console exporter conflicts with the SDK message channel and should not be used. ([SDK observability](https://code.claude.com/docs/en/agent-sdk/observability))

- Export failures are silent by default; `CLAUDE_CODE_OTEL_DIAG_STDERR=1` surfaces diagnostics through the SDK stderr hook on supported versions. ([SDK observability](https://code.claude.com/docs/en/agent-sdk/observability))

- Default export intervals are 60 seconds for metrics and 5 seconds for traces/logs; abrupt termination can lose buffered telemetry. ([SDK observability](https://code.claude.com/docs/en/agent-sdk/observability))

## 12. Auth and tenancy

### Authentication

- Standard Claude API authentication uses an API key in the `x-api-key` header. ([Authentication](https://platform.claude.com/docs/en/manage-claude/authentication))

- Normal API keys use the `sk-ant-api` prefix. ([Authentication](https://platform.claude.com/docs/en/manage-claude/authentication))

- Workload Identity Federation can exchange external identity for short-lived bearer credentials. ([Authentication](https://platform.claude.com/docs/en/manage-claude/authentication))

- The platform also documents App Attest for supported client-attestation use cases. ([Authentication](https://platform.claude.com/docs/en/manage-claude/authentication))

- Managed Agents beta calls require the corresponding `anthropic-beta` header in addition to authentication. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview))

### Workspace boundaries

- API keys are scoped to a workspace. ([Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces))

- Files API resources are workspace-scoped. ([Files API](https://platform.claude.com/docs/en/build-with-claude/files))

- Managed Vaults are workspace-scoped and usable by any API key in that workspace. ([Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

- Prompt caches are isolated by workspace. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- A workspace is therefore the native control-plane boundary, but per-end-user row-level tenancy inside one workspace remains the customer's responsibility. ([Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces))

### Spend and administration

- Console usage tiers currently document monthly organization limits of $500 for Start, $1,000 for Build, and $200,000 for Scale; custom arrangements may differ. ([Rate limits](https://platform.claude.com/docs/en/api/rate-limits))

- An organization can set a lower customer-defined spend limit. ([Rate limits](https://platform.claude.com/docs/en/api/rate-limits))

- Managed Sessions support a per-Session budget control. ([Usage and costs](https://platform.claude.com/docs/en/managed-agents/usage-and-costs))

- Admin API keys use the `sk-ant-admin` prefix; OAuth tokens need the `org:admin` scope for Admin API access. ([Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api))

- The Admin API manages organization members/invites, workspaces/members, API keys, and usage/cost reporting. ([Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api))

- Organization roles include `user`, `claude_code_user`, `developer`, `billing`, and `admin`. ([Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api))

- The platform does not provide application-level tenant identities, tenant authorization policies, or tenant-aware custom-tool credentials automatically: those remain product-layer concerns. ([Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces), [Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

## 13. Pricing and limits that shape architecture

### Managed Agents pricing

- Model input/output and prompt-cache tokens use normal Claude API token pricing. ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

- Managed sandbox runtime costs $0.08 per running Session-hour, metered to milliseconds. ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

- Idle, rescheduling, and terminated time is not charged as sandbox runtime. ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

- There is no separate container provisioning charge. ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

- Message Batches pricing is unavailable for Managed Agents. ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

- US-only inference geography applies a 1.1× token-price multiplier. ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

- Web search costs $10 per 1,000 searches in addition to token charges. ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

### Model envelopes at this snapshot

| Model family | Context | Max output | Base input/output per MTok |
|---|---:|---:|---:|
| Fable 5 | 1M | 128K | $10 / $50 |
| Opus 5 | 1M | 128K | $5 / $25 |
| Sonnet 5 | 1M | 64K | $3 / $15 standard |
| Haiku 4.5 | 200K | 64K | $1 / $5 |

Source: [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing). Sonnet 5 introductory pricing of $2/$10 is documented through 2026-08-31; architecture should use standard pricing for steady-state forecasts. ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

- Managed Agents accepts Claude 4.5+ even though not every model has the same context/output envelope. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup))

- Effective long-turn capacity is also shaped by tool results, Skill metadata, MCP schemas, and automatic compaction. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview), [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

### Platform and resource limits

| Limit | Value | Source |
|---|---:|---|
| Managed Agent create/update operations | 300 requests/minute | [Rate limits](https://platform.claude.com/docs/en/api/rate-limits) |
| Managed read/stream operations | 1,200 requests/minute | [Rate limits](https://platform.claude.com/docs/en/api/rate-limits) |
| Initial events per Session | 50 | [Sessions](https://platform.claude.com/docs/en/managed-agents/sessions) |
| Request body | 32 MB | [Sessions](https://platform.claude.com/docs/en/managed-agents/sessions) |
| Mounted Files per Session | 500 | [Files](https://platform.claude.com/docs/en/managed-agents/files) |
| File size | 500 MB | [Files API](https://platform.claude.com/docs/en/build-with-claude/files) |
| File storage per organization | 500 GB | [Files API](https://platform.claude.com/docs/en/build-with-claude/files) |
| File API beta request rate | approximately 100/minute | [Files API](https://platform.claude.com/docs/en/build-with-claude/files) |
| Skills per Session after deduplication | 500 | [Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills) |
| MCP servers per Agent | 20 | [Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector) |
| Credentials per Vault | 20 | [Vaults](https://platform.claude.com/docs/en/managed-agents/vaults) |
| Coordinator roster entries | 20 | [Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration) |
| Concurrent threads per Session | 25, advisors excluded | [Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration) |
| Cloud sandbox RAM | up to 8 GB | [Cloud sandboxes](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference) |
| Cloud sandbox disk | 10 GB | [Cloud sandboxes](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference) |
| Sandbox checkpoint lifetime | 30 days from creation | [Events](https://platform.claude.com/docs/en/managed-agents/events-and-streaming) |
| Outcome iterations | default 3, maximum 20 | [Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes) |

- Managed rate limits are separate from Messages API endpoint limits, but model-token usage limits still apply. ([Rate limits](https://platform.claude.com/docs/en/api/rate-limits))

- A numeric cloud-sandbox turn timeout and maximum total Session age are **UNVERIFIED.** ([Cloud sandboxes reference](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference))

- SDK `maxTurns` and application budgets are customer-configured controls, not hosted capacity guarantees. ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents), [Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking))

## 14. Prompt caching for a long agent turn

### Core cache behavior

- Prompt caching reuses an exact prompt prefix; the hierarchy is tools, then system, then messages. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- The default cache lifetime is five minutes and is refreshed on a cache hit. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- The TTL is measured from the request start time. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- A one-hour TTL is also available. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- Cache reads cost 0.1× base input price; five-minute writes cost 1.25× and one-hour writes cost 2×. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing))

- A cache entry created by one concurrent request is not readable until that request's first response begins. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- Up to four explicit cache breakpoints are supported. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- The cache lookup searches backward up to 20 content blocks from each breakpoint. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- Automatic caching moves the breakpoint to the last cacheable block as the conversation grows. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

### What invalidates or moves reuse boundaries

| Change | Invalidates |
|---|---|
| Tool definitions | Tools, system, and messages after the changed prefix |
| Web-search/citation configuration | System and messages |
| Speed setting | System and messages |
| `tool_choice` | Messages |
| Image presence/content | Messages |
| Thinking/effort changes | Always message cache; model-dependent effects on system/tools |
| `disable_parallel_tool_use` | Messages |

Sources: [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching).

- Any byte/token difference before a breakpoint prevents reuse beyond the first differing prefix. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- Adding later conversation turns preserves reuse of an unchanged earlier prefix. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- Server-tool result blocks receive automatic five-minute breakpoints when prompt caching is enabled on the request. ([Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching))

- Code-execution container state and prompt-cache state are separate mechanisms. ([Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching))

### Managed Agents implications

- Managed Agents enables prompt caching and context compaction inside its hosted loop. ([Overview](https://platform.claude.com/docs/en/managed-agents/overview))

- The customer does not reconstruct the full message array on every internal model step. ([Migration guide](https://platform.claude.com/docs/en/managed-agents/migration))

- Long turns benefit when the resolved Agent prompt/tool prefix remains stable across iterations. ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- Updating tools or MCP configuration mid-session can change the cached prefix for subsequent model requests. ([Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations), [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- Session-specific model/system/tool overrides reduce cross-Session prefix sharing when they differ. ([Sessions](https://platform.claude.com/docs/en/managed-agents/sessions), [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

- Cache usage is visible through Session usage fields, including reads and 5-minute/1-hour writes. ([Usage and costs](https://platform.claude.com/docs/en/managed-agents/usage-and-costs))

### Agent SDK implications

- The `claude_code` preset normally embeds working directory, repository status, platform, shell, OS version, and auto-memory paths in the system prompt. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

- Those dynamic fields prevent system-prompt cache sharing across different machines/directories. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

- `excludeDynamicSections:true` / `exclude_dynamic_sections:True` moves that context to the first user message, leaving a stable preset-plus-append system prefix. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

- That option requires TypeScript SDK 0.2.98+ or Python SDK 0.1.58+ and applies only to the preset object form. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

- `CLAUDE.md` does not alter the system prompt cache because SDK injects it as conversation context. ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts))

## Mechanisms worth copying

1. Persist an authoritative event log independently from ephemeral token deltas so reconnects recover completed state. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

2. Snapshot resolved, versioned Agent configuration into every Session and support optimistic-concurrency updates. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup), [Sessions](https://platform.claude.com/docs/en/managed-agents/sessions))

3. Separate durable conversation retention from explicitly bounded sandbox-checkpoint retention. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

4. Model every external tool wait as a visible `requires_action` state keyed by stable tool-use IDs. ([Custom tools](https://platform.claude.com/docs/en/managed-agents/custom-tools))

5. Give each delegated worker isolated context but a shared, explicit workspace, with hard depth and concurrency limits. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

6. Treat Skill metadata, instructions, and resources as three progressive-disclosure levels. ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

7. Make network egress limited-by-allowlist in production and keep package-manager/MCP exceptions explicit. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

8. Emit cumulative usage before every idle transition, including cache, runtime, server-tool, and monetary dimensions. ([Usage and costs](https://platform.claude.com/docs/en/managed-agents/usage-and-costs))

9. Separate outcome grading into an independent context and cap revision cycles. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

10. Spill oversized tool output to files and return a bounded preview plus durable path to the model. ([Tools](https://platform.claude.com/docs/en/managed-agents/tools))

## What it does NOT give you

- Application tenancy: map users/organizations to Anthropic workspaces or stricter internal partitions, and enforce row-level authorization in every custom tool. ([Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces))

- A product identity layer: build end-user accounts, roles, delegated authorization, impersonation controls, and audit attribution above API-key authentication. ([Authentication](https://platform.claude.com/docs/en/manage-claude/authentication))

- Per-tenant secret policy: decide credential ownership, rotation, revocation, OAuth consent, and least-privilege access despite workspace-shared Vault usability. ([Vaults](https://platform.claude.com/docs/en/managed-agents/vaults))

- Exactly-once business side effects: implement idempotency keys, outbox/inbox deduplication, transactional writes, compensations, and human reconciliation around custom tools. ([Custom tools](https://platform.claude.com/docs/en/managed-agents/custom-tools))

- Durable job settlement: define what “submitted,” “accepted,” “published,” “charged,” and “rolled back” mean for the product; an outcome rubric is not that protocol. ([Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- Reliable notification delivery: persist polling cursors or reconcile Session state because webhooks can duplicate, reorder, and be dropped after retries. ([Webhooks](https://platform.claude.com/docs/en/managed-agents/webhooks))

- Domain-specific tool infrastructure: host APIs, validate inputs/outputs, enforce permissions, control side effects, and return custom-tool results. ([Custom tools](https://platform.claude.com/docs/en/managed-agents/custom-tools))

- Tenant data governance: implement classification, residency policy, deletion workflows across copied external data, legal holds, and product-specific retention. ([Files API](https://platform.claude.com/docs/en/build-with-claude/files), [Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- Skill supply-chain security: review and pin repository content, scan scripts, control publishers, and roll back malicious or broken versions. ([Managed Skills](https://platform.claude.com/docs/en/managed-agents/skills))

- End-to-end observability: correlate product requests, external tools, databases, Managed events, user-visible actions, and billing in the team's own telemetry backend. ([Usage and costs](https://platform.claude.com/docs/en/managed-agents/usage-and-costs))

- Product SLAs and failover: define availability objectives, queueing, admission control, region/provider fallback, degraded modes, and incident response around documented rate/resource limits. ([Rate limits](https://platform.claude.com/docs/en/api/rate-limits))

- Cost allocation and commercial billing: attribute usage per tenant, add margins/credits, enforce plan quotas, and use authoritative billing data rather than SDK estimates. ([Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking), [Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api))

- Long-term artifact storage: export needed sandbox outputs before the fixed checkpoint expires and place them in a governed object/document store. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))

- UX for approval and recovery: build interfaces for `requires_action`, denied tools, interruption, partial progress, retries, expired sandboxes, and failed outcomes. ([Tool confirmations](https://platform.claude.com/docs/en/managed-agents/tool-confirmations), [Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations))

- Quality assurance: create evaluations, adversarial tests, regression gates, prompt/Skill rollout policy, and canaries around Agent versions. ([Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup), [Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes))

- A generic inbound MCP product surface: expose and authorize your own MCP server if other clients must invoke the product through MCP. ([Managed MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector))

- Unlimited recursive organizations: Managed coordination is intentionally one delegation level and 25 concurrent threads, so deeper workflows need product orchestration or multiple Sessions. ([Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration))

- Cross-Session shared filesystem state: use an external store or mounted resources because cloud Session sandboxes are isolated. ([Environments](https://platform.claude.com/docs/en/managed-agents/environments))

- Replayable live deltas: persist UI-ready incremental output yourself if exact after-disconnect token playback matters. ([Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming))


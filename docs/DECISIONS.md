# Locked Decisions Registry

Source of truth for architectural decisions in `@boring/agent`. Any PR that changes a locked decision must update this document and include rationale in the PR description.

See also: [REVIEW_DECISIONS.md](./REVIEW_DECISIONS.md) for adopted/deferred findings from external reviews.
See also: [WORKSPACE_CONTRACT.md](./WORKSPACE_CONTRACT.md) for the `@boring/agent` ↔ `@boring/workspace` integration contract.

Each decision has four fields:

- **What** -- the decision itself
- **Why** -- the motivation
- **Rationale** -- why this choice over alternatives
- **Re-evaluate when** -- the trigger that would justify revisiting

---

## 1. Standalone shape

| Field | |
|---|---|
| **What** | CLI-first product (`npx @boring/agent`); same product shape as Claude Code. |
| **Why** | Developers need a zero-config entry point. CLI is the lowest-friction distribution for Node tooling. |
| **Rationale** | Library-first would require users to wire up a server. CLI ships a working experience out of the box and can still be imported as a library. |
| **Re-evaluate when** | Library usage grows beyond CLI usage. |

## 2. Chat UI

| Field | |
|---|---|
| **What** | Vercel ai-elements (copied into repo) + `@ai-sdk/react useChat`. |
| **Why** | ai-elements provides battle-tested chat primitives; copying avoids version coupling. |
| **Rationale** | Copying (not depending) lets us diverge without waiting for upstream releases. `useChat` is the standard React hook for AI SDK streams. |
| **Re-evaluate when** | ai-elements API stabilizes or a maintained fork emerges. |

## 3. Wire protocol

| Field | |
|---|---|
| **What** | AI SDK UIMessage stream end-to-end. |
| **Why** | Single message format from harness through SSE to React avoids translation layers. |
| **Rationale** | UIMessage is already what `useChat` expects. Any custom format would require a mapping step on both server and client. |
| **Re-evaluate when** | AI SDK introduces breaking changes to the UIMessage format. |

## 4. v1 harness

| Field | |
|---|---|
| **What** | `@mariozechner/pi-coding-agent` as the v1 agent harness. |
| **Why** | pi-coding-agent provides a working agent loop with tool execution, session management, and streaming. |
| **Rationale** | Building an agent loop from scratch would delay v1 by weeks. pi-coding-agent is proven and actively maintained. |
| **Re-evaluate when** | pi stability regresses OR ai-sdk harness needs arrive (boring-macro migration). |

## 5. Harness interface

| Field | |
|---|---|
| **What** | Generic `AgentHarness` interface with `placement: server \| browser`. Future browser-agent is a sibling adapter, not a migration. |
| **Why** | Decouples the HTTP layer from the agent implementation. |
| **Rationale** | A generic interface lets us swap pi-coding-agent for AI SDK or a browser-local agent without touching routes. The `placement` discriminator makes the constraint explicit. |
| **Re-evaluate when** | A browser-agent harness is implemented and the interface needs revision. |

## 6. Tool catalog

| Field | |
|---|---|
| **What** | 4 base tools (bash, read, write, edit) + conditional `execute_isolated_code` (sandbox capability-gated). |
| **Why** | Minimal baseline that covers core coding tasks. |
| **Rationale** | More tools increase LLM context cost and confuse the model. Start with the essentials; richer sandboxes auto-lift the catalog. |
| **Re-evaluate when** | User feedback shows missing tools block common workflows. |

## 7a. Workspace (local)

| Field | |
|---|---|
| **What** | `NodeWorkspace` with ported `validatePath` / `assertRealPathWithinWorkspace`. |
| **Why** | Local file access with path-traversal protection. |
| **Rationale** | Reusing validated path logic from prior work avoids re-introducing security bugs. |
| **Re-evaluate when** | Node.js gains native workspace sandboxing APIs. |

## 7b. Workspace (remote)

| Field | |
|---|---|
| **What** | `VercelSandboxWorkspace` delegates to `sandbox.fs.*` + `sandbox.writeFiles`. |
| **Why** | Remote execution requires delegating FS operations to the sandbox runtime. |
| **Rationale** | Vercel's sandbox API provides a secure, ephemeral filesystem. Wrapping it behind the Workspace interface keeps the rest of the stack unaware of the execution context. |
| **Re-evaluate when** | Alternative remote sandbox providers are needed. |

## 7c. Sandbox (local)

| Field | |
|---|---|
| **What** | `BwrapSandbox` (`capabilities: ['exec']`) pairs with NodeWorkspace. |
| **Why** | Local code execution needs isolation from the host. |
| **Rationale** | bubblewrap (bwrap) provides Linux namespace isolation without root. Capability-gated so the sandbox only exposes what the tool needs. |
| **Re-evaluate when** | Non-Linux local execution is required (macOS, Windows). |

## 7d. Sandbox (remote)

| Field | |
|---|---|
| **What** | `VercelSandboxExec` (`capabilities: ['exec']`) pairs with VercelSandboxWorkspace. |
| **Why** | Remote code execution via Vercel's sandbox runtime. |
| **Rationale** | Pairs naturally with VercelSandboxWorkspace. Same capability interface as BwrapSandbox. |
| **Re-evaluate when** | Alternative remote execution environments are needed. |

## 7e. Pairing invariant

| Field | |
|---|---|
| **What** | Workspace + Sandbox MUST target the same execution context. Enforced at adapter construction; no mixed pairings. |
| **Why** | A NodeWorkspace with a VercelSandboxExec would read local files but execute remotely -- silently broken. |
| **Rationale** | Compile-time/construction-time enforcement is cheaper than debugging subtle runtime mismatches. |
| **Re-evaluate when** | A legitimate cross-context pairing emerges. |

## 7f. Mode selection

| Field | |
|---|---|
| **What** | `mode = "direct" \| "local" \| "vercel-sandbox"` in config. Env override via `BORING_AGENT_MODE`. |
| **Why** | Each mode selects a Workspace + Sandbox pairing. |
| **Rationale** | Three named modes cover all current deployment targets. Env override supports CI and container deploys. |
| **Re-evaluate when** | A fourth execution context is needed. |

## 8. Plugins

| Field | |
|---|---|
| **What** | Coexist via pi extensions in direct/local modes only. Remote mode skips extension load. |
| **Why** | Plugins are Node-native (require filesystem, child_process). Remote sandboxes can't load them. |
| **Rationale** | Restricting to direct/local avoids silent failures in remote mode. Pi's extension system handles discovery and lifecycle. |
| **Re-evaluate when** | A WASM-based plugin format enables remote extension loading. |

## 9. Sessions

| Field | |
|---|---|
| **What** | `SessionStore` interface + `PiSessionStore` (JSONL) in v1. |
| **Why** | Conversation persistence across page reloads and server restarts. |
| **Rationale** | JSONL is append-only, human-readable, and trivial to implement. The platform-agnostic interface allows future SQLite or IndexedDB backends. |
| **Re-evaluate when** | Session data grows large enough to need indexed queries. |

## 10. API key

| Field | |
|---|---|
| **What** | `ANTHROPIC_API_KEY` env var only. `VERCEL_OIDC_TOKEN` in remote mode. 12-factor. |
| **Why** | No config files, no UI for secrets. |
| **Rationale** | Env vars are the standard for secrets in server-side apps. Avoids accidentally committing keys. OIDC for remote mode enables keyless auth. |
| **Re-evaluate when** | Multi-provider key management is needed. |

## 11. Workspace scope

| Field | |
|---|---|
| **What** | Single workspace per instance. `workspaceId` from config. No runtime CRUD; that belongs to `@boring/cloud`. |
| **Why** | The agent operates on one project at a time. Multi-workspace is a platform concern. |
| **Rationale** | Single-workspace simplifies the entire stack: one root, one sandbox, one session store scope. |
| **Re-evaluate when** | `@boring/cloud` needs the agent to manage workspaces. |

## 11b. Session surface

| Field | |
|---|---|
| **What** | Lightweight `<SessionToolbar />` + `useSessions()`. List/create/switch/delete in v1; rename deferred. |
| **Why** | Users need to manage multiple conversations without external tools. |
| **Rationale** | Toolbar is the minimum viable session UI. Rename adds complexity with low initial value. |
| **Re-evaluate when** | Users request session organization features (folders, search, rename). |

## 11c. Standalone app

| Field | |
|---|---|
| **What** | First-class CLI (`bin/boring-agent`). Same code as `pnpm dev`. |
| **Why** | One codebase, two entry points. Development and production use identical code paths. |
| **Rationale** | Avoids "works in dev, breaks in prod" divergence. |
| **Re-evaluate when** | Production deployment requires a different build pipeline. |

## 11d. Model + thinking UI

| Field | |
|---|---|
| **What** | Inline in `<Composer />` -- per-message concerns. |
| **Why** | Model and thinking level are per-turn decisions, not global settings. |
| **Rationale** | Inline controls match the user's mental model: "for this message, use this model with this thinking level." Global settings would require mode-switching. |
| **Re-evaluate when** | Users consistently want the same model/thinking for all messages. |

## 11e. Dev-friendly direct mode

| Field | |
|---|---|
| **What** | Third mode alongside local and vercel-sandbox. Uses `child_process.exec` + `cwd`. Documented NO-sandbox posture. |
| **Why** | Developers need a fast iteration loop without sandbox setup overhead. |
| **Rationale** | Direct mode trusts the developer's machine. The no-sandbox trade-off is explicit and documented. |
| **Re-evaluate when** | Direct mode is used in non-development contexts. |

## 11f. Settings

| Field | |
|---|---|
| **What** | Env vars only. No `/api/settings`. No runtime prefs file. |
| **Why** | Configuration is a deployment concern, not a runtime concern. |
| **Rationale** | Env vars are sufficient for v1. A settings API adds surface area and state to manage. |
| **Re-evaluate when** | Non-technical users need runtime configuration. |

## 11g. AI SDK harness

| Field | |
|---|---|
| **What** | NOT in v1. Design seam exists. boring-macro migration = rewrite `pi-coding-agent` adapter. |
| **Why** | pi-coding-agent works today. AI SDK harness would be a rewrite with no immediate user benefit. |
| **Rationale** | The `AgentHarness` interface (decision 5) ensures the seam is clean. Migration is a contained effort when the time comes. |
| **Re-evaluate when** | AI SDK ships agent-loop primitives that outperform pi-coding-agent. |

## 12. Backend stack

| Field | |
|---|---|
| **What** | Fastify + Node ESM. |
| **Why** | Fastify is the fastest mainstream Node HTTP framework. ESM aligns with the ecosystem direction. |
| **Rationale** | Express is slower and less maintained. Hono was considered but Fastify's plugin system and ecosystem are more mature. |
| **Re-evaluate when** | Performance profiling shows Fastify as a bottleneck, or the ecosystem shifts. |

## 13. Styling

| Field | |
|---|---|
| **What** | CSS custom properties (`--boring-chat-*`) + render-prop escape hatches. |
| **Why** | Consumers need theming without CSS-in-JS runtime or build-tool coupling. |
| **Rationale** | Custom properties work everywhere, compose with any framework, and have zero runtime cost. Render props cover cases where CSS alone isn't enough. |
| **Re-evaluate when** | A widely-adopted zero-runtime CSS-in-JS solution emerges. |

## 14. UI export pattern

| Field | |
|---|---|
| **What** | Default component + primitives + headless hook -- for every user-facing piece. |
| **Why** | Three levels of abstraction serve three audiences: drop-in users, customizers, and headless integrators. |
| **Rationale** | This is the established pattern in the React component library ecosystem (Radix, Headless UI). |
| **Re-evaluate when** | Usage data shows one tier is unused. |

## 15. Export surface

| Field | |
|---|---|
| **What** | Locked names: `ChatPanel`, `SessionToolbar`, `Message`, `MessageGroup`, `Composer`, `ModelPicker`, `ThinkingToggle`, `Tool`, `Terminal`, `CodeBlock`, `Reasoning`, `NewChatButton`, `useAgentChat`, `useSessions`, `theme.css`. |
| **Why** | Public API stability. Renaming exports is a breaking change for consumers. |
| **Rationale** | Locking names early prevents accidental API churn. The list covers the full chat experience. |
| **Re-evaluate when** | A major version bump allows breaking changes. |

## 16. Import convention

| Field | |
|---|---|
| **What** | `@boring/agent` (top-level, browser-safe) + `@boring/agent/server` (Node-only) + `@boring/agent/shared` (type-only). |
| **Why** | Separate entry points prevent Node APIs from leaking into browser bundles. |
| **Rationale** | Three entry points match three execution contexts. `shared` is type-only to avoid any runtime dependency. |
| **Re-evaluate when** | A fourth entry point is needed (e.g., `@boring/agent/worker`). |

---

## Process

1. Any PR that changes a locked decision **must** update this document.
2. The PR description must include rationale for the change.
3. Reviewers check DECISIONS.md for drift from the codebase.
4. To propose a new locked decision, add it here with all four fields and get team sign-off.

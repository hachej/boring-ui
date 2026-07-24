# Locked Decisions Registry

Source of truth for architectural decisions in `@hachej/boring-agent`. Any PR that changes a locked decision must update this document and include rationale in the PR description.

See also: [REVIEW_DECISIONS.md](kanzen/REVIEW_DECISIONS.md) for adopted/deferred findings from external reviews.
See also: [WORKSPACE_CONTRACT.md](./WORKSPACE_CONTRACT.md) for the `@hachej/boring-agent` ↔ `@hachej/boring-workspace` integration contract.

> **Reader note (registry is historical; entries are not rewritten):** Some
> entries below predate later changes and use names/scopes that have since moved.
> In particular: (1) the published package scope is now `@hachej/boring-*` (e.g.
> `@hachej/boring-agent`), not `@boring/*`; (2) the chat UI was rewritten to be
> pi-native — decisions **2**, **11b**, **11d**, **14**, and **15** describe the
> pre-rewrite ai-elements export surface (`ChatPanel`, `SessionToolbar`,
> `Composer`, `ModelPicker`, `useAgentChat`/`useSessions`, `theme.css`). The
> current public front surface is the `Pi*` / `usePiSessions` family and styling
> ships via `@hachej/boring-agent/front/styles.css` — see
> [WORKSPACE_CONTRACT.md](./WORKSPACE_CONTRACT.md) §2–3 for the live list; and
> (3) `@boring/cloud` (decision 11) remains a planned, not-yet-extracted package.
> The original decisions are preserved for rationale and history.

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
| **What** | Workspace + Sandbox MUST target the same execution context. Enforced at adapter construction; no mixed pairings. The public workspace namespace must stay coherent across file tree root, shell cwd, model-visible cwd, and `BORING_AGENT_WORKSPACE_ROOT`. |
| **Why** | A NodeWorkspace with a VercelSandboxExec would read local files but execute remotely -- silently broken. Leaking adapter-private roots into model-visible paths creates the same class of split-brain bug. |
| **Rationale** | Compile-time/construction-time enforcement is cheaper than debugging subtle runtime mismatches. One public namespace keeps prompts, tools, and shell observations talking about the same place. |
| **Re-evaluate when** | A legitimate cross-context pairing emerges. |

> **Supersession note (#391 v2):** This pairing invariant remains binding for
> any boring-bash-active runtime where a filesystem/exec environment is
> attached. Pure/headless agents (`runtime: 'none'`) run without `Workspace`,
> `Sandbox`, cwd, file routes, or bash tools, so there is no Workspace+Sandbox
> pair to construct. When boring-bash is present, file tree, search/watch, bash,
> git/status, and model-visible cwd must still share one source of truth.

## 7f. Mode selection

| Field | |
|---|---|
| **What** | `mode = "direct" \| "local" \| "vercel-sandbox"` in config. Env override via `BORING_AGENT_MODE`. |
| **Why** | Each mode selects a Workspace + Sandbox pairing. |
| **Rationale** | Three named modes cover all current deployment targets. Env override supports CI and container deploys. |
| **Re-evaluate when** | A fourth execution context is needed. Note: non-builtin modes are already supported without core edits — pass a custom `runtimeModeAdapter` to `createAgentApp`/`registerAgentRoutes` (see `packages/agent/docs/runtime.md`). |

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
| **What** | CSS custom properties (`--boring-agent-*`) + render-prop escape hatches. |
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

## 17. Plugin-authoring guidance delivery

| Field | |
|---|---|
| **What** | Two complementary injection paths for plugin-authoring guidance, both sourced from `@hachej/boring-pi`. The package ships SKILL.md + reference markdown docs ONLY (no code, no templates). It is a runtime dep of `@hachej/boring-workspace` (so any workspace install pulls it in transitively) AND is installable standalone (for npx-style flows where workspace isn't present). |
| **Why** | Agents need two kinds of help: (a) eager workflow nudges in the system prompt so smaller models don't drift, (b) a deeper how-to reference the agent can pull on demand. Different agent runtimes discover skills/docs differently; we need one source of truth that both paths can consume without per-host install dances. |
| **Rationale** | **Entrance 1 — Pi auto-discovery:** Pi scans `node_modules/*/package.json` for `pi.skills`. `@hachej/boring-pi` declares it and ships `skills/boring-plugin-authoring/SKILL.md`. The skill appears in the agent's `<available_skills>` block with name + description + absolute `<location>` path; agent reads via its own `read` tool if relevant. Works for any Pi-driven agent, including standalone pi-coding-agent runs that never touch boring-workspace. **Entrance 2 — workspace appendix pointer block:** `packages/workspace/src/server/boringSystemPrompt.ts` generates a short pointer-block addendum (~250 tokens, NOT the full SKILL inlined) that mirrors Pi's own "Pi documentation" prompt style: a topic-to-path map referencing absolute paths into the boring-pi install. `boringSystemPrompt.ts` resolves boring-pi's install path via `require.resolve("@hachej/boring-pi/package.json")` — same pattern Pi uses for itself (`import.meta.url`-based), differing only because we resolve a dep rather than ourselves. **Why keep boring-pi as a separate package** (instead of inlining into workspace): a slim docs-only package can be installed standalone (`pnpm add @hachej/boring-pi`) by users running an external Pi agent that scaffolds via `npx @hachej/boring-ui-cli` but never installs the workspace runtime. Bundling docs into workspace would make that flow require pulling in the full UI runtime to get the skill. **Why not inline SKILL.md content into the appendix:** burns ~3K tokens per turn whether the user is touching plugins or not; the pointer-block pattern matches Pi's own design and keeps per-turn cost low. **Why not skills-only (delete the appendix):** smaller models miss skill descriptions and write plugins from training memory; the eager pointer block guarantees the agent at least KNOWS where to look. |
| **Re-evaluate when** | A consumer needs the skill WITHOUT installing workspace AND without installing boring-pi (would justify a third delivery mechanism); OR token budget pressure forces dropping the eager pointer block; OR Pi changes its package-scanning contract for skills. |

## 18. Workspace runtime install: symlink-to-global vs. self-contained tarball

| Field | |
|---|---|
| **What** | An external install source (e.g. the host's global `@hachej/boring-ui-cli`) is materialized into a workspace's runtime differently per mode. **Direct mode (no OS sandbox)** installs it as a `file:` dependency, which npm resolves to a symlink into the host's global `node_modules` — and that is the correct default there. **Sandbox modes (local/bwrap, vercel-sandbox)** instead pack the source into a self-contained tarball inside the workspace and let `npm install <.tgz>` / `uv pip install <.tar.gz>` extract a real copy, via one shared `resolveArtifactInstallSource()`/`packProvisioningArtifact()` (`workspace/provisioning/packArtifact.ts`). No directory symlink escapes the workspace in a sandbox mode. |
| **Why** | npm materializes a `file:` *directory* dep as a symlink (like `npm link`), and its `.bin` shim then `realpath`-resolves to the host's global install — outside the workspace root. In direct mode that is fine (the process runs on the host where the link resolves) and is the fastest, lowest-disk option. In a sandbox the target lives outside the bind mount, so the link is invisible/dangling and the realpath guard rejects it; the sandbox must therefore receive an extracted copy, not a link. Unifying both sandbox providers on the same pack→extract path keeps provider-specific code from inventing a separate app-materialization path (see the preprovisioned-base plan's "reuse the serve-time runtime path" constraint). |
| **Rationale** | The escaping `.bin/boring-ui` symlink is npm's standard behavior, not a design choice; it crash-looped sandbox provisioning (the realpath guard threw, breaking the skip-vs-reinstall short-circuit). A naive copy of a *directory* source still leaves a symlink hop; packing to a tarball is what yields a true extracted copy, and is what the vercel mode already did — so the local mode was aligned to it rather than the reverse. **Scope:** pack self-contains the CLI *package*, not its full transitive dependency tree (the workspace CLI is a thin shim by design), so the per-install escaping-symlink problem is solved, but making the CLI's whole dep tree present *inside* a sandbox — and the boot-speed win — remains the separate [preprovisioned-base-runtime acceleration](./plans/archive/preprovisioned-base-runtime-acceleration-plan.md) work. |
| **Re-evaluate when** | The preprovisioned-base / bundled-dep-tree runtime ships (then "self-contained" extends from the package to the whole tree, and the symlink-tolerance kept for direct mode could be revisited); OR npm changes how it materializes `file:` deps; OR a workspace must run the global CLI *inside* a sandbox where the global path is not mounted. |

## 19. Runtime-free agent core and pluggable surfaces

> **Current scope:** Decision 28 retains package layering, the service-shaped
> Agent direction, named filesystem bindings, and EU-default principles. It
> supersedes Decision 19's dependency details with Workspace orchestration,
> `boring-bash` Environment service ownership, and Agent/Workspace-neutral
> `boring-sandbox` backends. Remote bindings still require named consumers.

| Field | |
|---|---|
| **What** | Ratify the #391 v2 plan pack: `@hachej/boring-agent` becomes the headless model/session/tool core with zero value imports from `@hachej/boring-bash` or `@hachej/boring-sandbox`; `@hachej/boring-bash` owns the optional fs+exec runtime, file routes/tools/UI, bash requirement normalization, and runtime-mode resolution; `@hachej/boring-sandbox` owns concrete providers, FUSE-S3 mounts, lifecycle, and capability facts; workspace UI, Slack, spreadsheet, CLI, and future surfaces are thin ingress/egress adapters over one event-stream contract. Source paths: docs/issues/391/runtime-refactor/README.md docs/issues/391/runtime-refactor/architecture/00-global-isa.md (package ownership table, Direction, North star, invariant 15) docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md docs/issues/391/runtime-refactor/architecture/09-environments-attachable.md <br><br>Locked decision statuses: <ol><li>Wire protocol — status: decided; source: 08 decision 1; cross-reference: §3. Keep `PiChatEvent` as the v1 payload, wrap it in the indexed `AgentEvent` envelope, and do not create a parallel event union.</li><li>Pure mode — status: decided; source: 08 decision 2 and 00 open decision 1. Use pi-coding-agent with `runtime: 'none'` and sealed cwd behind the Phase 1 audit; no second harness.</li><li>Surfaces outside the agent package — status: decided; source: 08 decision 3. Channel/surface packages follow the Flue-style package model rather than `boring-agent` subpaths.</li><li>Readonly fs is v1 — status: decided landed; source: 08 decision 4. The #416 readonly filesystem work resolves 00 open decision 6.</li><li>One-namespace rule superseded — status: decided superseded; source: 08 decision 5. Named `(filesystem, path)` bindings from #416 replace the single-namespace rule.</li><li>Channel ingress reused — status: decided; source: 08 decision 6. Use pinned `@flue/*` ingress packages with thin adapters; vendoring is only the fallback and hosting inside Flue's runtime is not adopted.</li><li>Environments attachable — status: decided; source: 08 decision 7 and 09. A filesystem plus sandbox has identity independent of any agent; agents, subagents, and external agents attach, with external access via MCP projection.</li><li>Front chat provider unchanged — status: decided with view-model migration deferred; source: 08 decision 8. Keep the current UI/provider projection; the deferred work is migrating the `PiChatEvent` reducer/view-model to native `UIMessage` and tool-approval parts.</li><li>No feature-flag framework — status: decided; source: 08 decision 9. Protocol/version change rides `AgentEvent.v`, additive DS routes during T1/T2, injectable front transport during cutover, and minor package bumps at T2/P3.</li><li>No retro-compat and no speculative abstraction — status: decided; source: 08 decision 10 and INDEX simplicity policy. Importers migrate in the same PR, temporary code names its deletion bead, and abstractions require real consumers.</li><li>Three-package runtime stack — status: decided; source: 08 decision 11 and 00 open decision 3. `boring-agent` defines contracts and imports neither runtime package; `boring-bash` is THE RUNTIME and imports sandbox values plus agent types; `boring-sandbox` owns providers, mounts, lifecycle, and capability facts with agent type-only imports.</li><li>v2 north star — status: decided for this epic's substrate; source: 00 North star and VISION North star. Eve-class declarative authoring, workspace-as-farm-control-plane, open foreign-agent integration, and Flue internals are the direction; agent-as-directory authoring and the farm UI remain explicitly deferred follow-ups.</li><li>EU-sovereign defaults — status: decided; source: 00 invariant 15 and VISION row 8. Defaults must be self-hostable on EU infrastructure; US-hosted providers such as `vercel-sandbox` stay optional behind the capability matrix.</li></ol>Deferred carryover from 00: <ol><li>Provisioning sharing defaults — status: deferred; owner phases: P5 provisioning/readiness and P6a AgentRegistry requirements; source: 00 open decision 5.</li><li>Surface addressing-store persistence — status: deferred; owner phases: T2 transport, S1/S2 concrete surface stores, and P7 agent scoping; source: 00 open decision 7 and 08 two-handles rule.</li></ol> |
| **Why** | The current agent docs and runtime decisions still assume Workspace+Sandbox+FileSearch as an agent baseline. That blocks true headless agents, non-workspace surfaces, spreadsheet embeds, Slack channels, and the farm/control-plane direction while also making the future `@hachej/boring-agent` package vulnerable to runtime import cycles. |
| **Rationale** | The v2 pack makes the plan pack the canonical design record and keeps this registry as the durable ratification surface. The five-layer model from 00 — Surfaces, Transport, Agent core, Features, Runtime — separates message ingress, replayable event transport, the model/session/tool loop, optional bash/file/UI features, and concrete providers. This preserves the existing workspace experience while making `runtime: 'none'` first-class and keeping boring-bash-active no-split-brain rules local to attached environments. |
| **Re-evaluate when** | The deferred `PiChatEvent` reducer/view-model migration to native `UIMessage` and tool-approval parts lands; a second real non-workspace surface proves the public contract needs a shape change; EU-hosted defaults cannot satisfy a required platform component; or the deferred 00 decisions above close and require narrowing this ratification. |

---

## 19a. #391 ships a dedicated agent-factory v1 before platform expansion

> **Superseded by Decision 25.** The AgentHost controller, CAS-like rollout,
> dedicated delivery path, and associated v1 gate graph are historical.

| Field | |
|---|---|
| **What** | Amend decision 19 without replacing its long-term direction. #391 ships incrementally. The formerly named Release 0 is an optional, non-blocking bearer-authenticated managed-MCP tracer with bounded self-contained output. V1 compiles a minimal agent directory to a self-contained content-addressed bundle containing a versioned behavior-only `AgentDefinition` and immutable assets, combines it with a separately versioned tenant/runtime `AgentDeployment`, records definition/deployment/resolved-snapshot digests on sessions, and delivers the same bundle through one dedicated EU deployment path. Events, pending approvals, waiting state, and authenticated-subject-scoped caller receipts share one SQLite `agent.db`. Authority is calculated from provider facts and policy/grants; requirements only validate active authority. agent-host uses a fenced crash-safe apply journal and is the sole v1 topology. P4, E2, X1/FUSE, P5 advanced services, P6 plugin/child-app expansion, P7, M2, D2, and S3/S4 are post-v1. |
| **Why** | The prior plan could complete a large substrate while deferring the stated product goal of quickly authoring and shipping an agent. It also coupled reusable behavior to pricing/deployment/tenancy, split one approval transition across two SQLite files, mixed requirements into the authority algebra, and required speculative FUSE/control-plane work before a dedicated delivery path. |
| **Rationale** | Two real consumers justify the small definition boundary immediately: local development and agent-host deployment. A separate deployment object keeps reusable behavior portable. One SQLite transaction removes the event/pending-state crash window. Dedicated tenancy gives a strong isolation baseline without inventing a shared tenant authority. Later capabilities retain their plans but earn implementation through a concrete consumer and separate exit. |
| **Re-evaluate when** | agent-host has repeated enough to justify shared tenancy; a second host needs the full filesystem presentation bundle; a native-mount consumer proves X1; multi-instance load requires Postgres; or a durable waiting-turn journal is required for restart continuation. |

---

## 20. Company-admin front surface: single app-composed provider slot, no plugin self-registration

| Field | |
|---|---|
| **What** | Core front exposes exactly one optional, declarative admin-surface slot: `CoreFront`'s `companyAdmin?: { loadStatus, renderContent, labels? }` prop, threaded through `CompanyAdminProvider`. The app composes it (e.g. full-app passes `createGovernanceCompanyAdmin()` from `@hachej/boring-governance/front`); plugins never register themselves into core front. With no provider configured — or a provider reporting `enabled !== true` / `admin !== true` — core renders **no trace** of the surface: no `UserMenu` entry, and the admin route navigates away. Core contains zero governance vocabulary (enforced by review grep: `grep -ri governance packages/core/src` must be empty). |
| **Why** | Core must stay generic: it knows "an admin surface descriptor was provided", never which plugin provided it. App-side composition (props, not a registry) makes ordering and conflicts a non-problem — the app decides explicitly in readable code, matching how the server seams compose (`plugins`, `filterModels`, `metering`, `getFilesystemBindings` are also app-spread). The workspace-pane plugin system is not reused because admin surfaces are app-level routes gated on a different axis (company admin) than workspace panes (workspace membership); conflating the two lifecycles would be wrong. |
| **Rationale** | v1 has exactly one consumer (boring-governance), so a multi-surface registry would be designed from a single example — the descriptor shape `{ loadStatus, renderContent, labels }` was instead made self-describing so pluralizing is mechanical. Designing a generic slot from one example risks wrong abstractions (composition order, deep-linking, per-section gating are unknowable without a second consumer). |
| **Re-evaluate when** | A second plugin needs an admin/workspace-management surface. Planned evolution: `companyAdmin` becomes `adminSections: Section[]` (same descriptor shape, plus an `id` for deep-linking); the admin page hosts one tab per section whose `loadStatus` reports `admin: true`; app array order is authoritative for display order; still no dynamic registration. |

## 21. Workspace-first agent factory v1 supersedes public pure mode

> **Current scope:** Decision 28 retains Workspace-first consumer authorization
> and the approved Environment requirement. It replaces exact-host runtime
> selection with signup-only default initialization, and replaces the combined
> Workspace/Sandbox host with Workspace-orchestrated AgentApplications consuming
> governed `boring-bash` Environment operations.

| Field | |
|---|---|
| **Status** | **Accepted (2026-07-11).** Landed via PR [#617](https://github.com/hachej/boring-ui/pull/617) (merge commit `e3ed7b6eb988c774fc5d2dff0d85a585cb6c885c`), verified as an ancestor of `origin/main`. |
| **What** | For v1, every local or deployed agent run resolves to an authorized workspace plus an approved runtime/environment. The dedicated journey is exact hostname -> landing -> member auth -> bound workspace -> deployed agent selected as that workspace's `default`. `headless` means only "no UI/presentation surface"; API, MCP, CLI, and future channel adapters still address a workspace-backed agent. There is no public/product no-environment mode and no v1 `runtime: 'none'` contract. |
| **Why** | The first product proof is a workspace-backed dedicated EU deployment. Treating no-environment execution as a parallel product mode added prompt, session, lifecycle, capability, and routing branches without a named v1 consumer. |
| **Rationale** | Keep the environment/Fastify-independent `@hachej/boring-agent/core` boundary, injected harness/tools/sessions, workspace/session-root separation, package layering, and optional surfaces. Compose those seams from a workspace host in v1. Local authoring still starts from `agents/<name>/`, but `agent dev` creates or selects an explicit local workspace and approved runtime (`bwrap` when available; trusted direct only by explicit policy). This decision supersedes decision 19's pure-mode choice and decision 19a's wider v1 gate graph where they conflict; decision 19a's R0 tracer is explicitly non-blocking. T1/T2 durability, full P3 extraction, generic E1 attachments, and true no-environment execution move post-v1. |
| **Re-evaluate when** | A named consumer cannot use a workspace-backed agent and brings an explicit contract for authorization, session/storage identity, tools/prompts/resources, secrets, readiness, and lifecycle. Reintroduction requires a new decision and conformance proof; it must be composition by explicit capabilities, never a new mode-label fork. Rollback likewise requires a new superseding registry entry and a deliberately restored dependency graph; stopped PRs never resume implicitly. |

## 22. One agent-consumption contract; protocol bindings at the edges

> **Current scope:** Decision 28 preserves protocol-at-edges, native semantic
> Agent invocation, and contracted projection principles. Initial delivery proves
> only a non-public two-Agent conformance path; product delegation, external A2A,
> and contracted Agents remain separately gated.

| Field | |
|---|---|
| **Status** | **Accepted (2026-07-11).** Landed via PR [#632](https://github.com/hachej/boring-ui/pull/632); implementation pending (AC1 / issue #636 — types landed #657, dispatcher/modes/projection not built). |
| **What** | An agent exposes ONE consumption contract in the contracts layer: task lifecycle (`submitted`/`working`/`completed`/`failed`/`canceled`/`rejected` plus the interrupted state `input-required`; types landed [#657](https://github.com/hachej/boring-ui/pull/657)), `contextId` grouping tasks into conversations, messages with typed parts, and artifacts. This is a deliberate **seven-state subset** of A2A v1.0, published 2026-03-12; A2A also defines `auth-required`, which is intentionally out of scope internally because there is no trust boundary inside one deployment. A future A2A edge binding must map `auth-required` explicitly. Bindings of that contract: **UI** (human chat); **MCP** (the external entry gate — the private M1/AR1 tracer may use a pre-provisioned bearer mapped to an existing regular principal + workspace membership; ID1 is mandatory before public/open self-service); an **HTTP API** (regular REST projection of the same task model; pre-provisioned credentials for the private tracer, ID1-backed keys before public self-service); a **CLI** (drives the HTTP API; same identity layer); a **native in-process binding** for internal agent-to-agent consumption (no MCP loopback, no serialization; two-way chat via `input-required`); and **A2A as a FUTURE external binding only**, taken up when an external org needs multi-turn task-driving against hosted agents. Adopting A2A internally is rejected as unnecessary. Every consumer in every binding is a regular principal + workspace; the tracer exception changes credential issuance timing, never the authorization model. |
| **Consumption modes and context flow** | (Owner-settled, grill round 2, 2026-07-11.) Two internal consumption modes, declared per agent in `AgentDefinition`: **(a) SUBAGENT** — runs inside the caller's workspace as a helper, full shared context; **(b) CONTRACTED/SERVICE** — runs in its OWN workspace (SaaS-like; may invoice the job — the economic layer is deferred with the workspace-budget concern, same trigger). **Context flow to a contracted agent: GOVERNED PROJECTION IN THE TASK.** The caller declares paths; a path-filtered READONLY snapshot of their workspace attaches to the task; the contractor works on it in its own workspace; more context is requested via `input-required`. Implementation seam: generalize boring-governance's existing `filesystemBindings` readonly-projection mechanism (today hardcoded to `company_context`) to arbitrary source workspaces. **Explicitly rejected: live cross-workspace access grants** (agent principals + TTL + arbitrary workspace resources in governance = a second ACL system; recon verdict "stretch": subjects are human-email-only, single governable workspace, no time bounds). Workspace membership remains the ONLY live access boundary. For long collaborations, an ENGAGEMENT workspace (plain shared membership) is the future pattern. **Contract spec items recorded for the implementation phase (not decisions):** `input-required` timeout/escalation policy; consumption cycle/depth guards (A→B→A); audit model — the principal is the originating user/workspace, with the acting agent recorded as actor in provenance; contract schema versioning once external bindings exist (npm consumers). |
| **Distribution model & layering constraint** | (Owner-settled, 2026-07-11.) The stack reads: **AgentDefinition at the core; distribution vectors layered on top** — (a) member of a workspace (subagent), (b) contracted agent consumed within a workspace, operating from its own. **MCP is orthogonal to distribution: it is a door, not a vector** — how a principal reaches their OWN workspace from outside. Composition for third parties: an external agent that wants to consume a contracted agent signs up (ID1) → gets its own workspace → contracts the agent from there, all via MCP; other workspaces and sandboxes stay invisible — from outside, boring presents as a **contracting platform**: submit a job, receive artifacts. Contractor workspaces persist across engagements, so contractors compound accumulated work and tooling across jobs. **Implementation constraint: contracted mode MUST be a layering over the same consumption pipeline as subagent mode — never a forked code path.** One invocation machinery (contract, task lifecycle, internal binding); the modes differ only in orthogonal layers: (1) the workspace-binding parameter on the resolver (caller's workspace vs the agent's own), (2) the governance layer supplying the projection brief instead of direct workspace context, (3) the billing/metering layer decorating the task via boring-governance's existing metering seam (`createMeteringSink`, per-model/per-user EUR budgets). A contractor = subagent + binding parameter + governance projection + metering. **Known-unknown (trigger: third parties contracting):** contractor data hygiene across customers — a persistent contractor workspace mixes learnings from customer A into work for B; policy needed when external contracting opens. |
| **Why** | Priorities 2–3 (external MCP consumption, multi-channel consumption) and internal multi-agent composition all need agents to consume agents. Without one contract, each surface invents its own task/message/artifact shapes and internal agent-to-agent traffic gets forced through a serialized protocol loop it does not need. |
| **Rationale** | One contract, many bindings keeps the loop owned in one place (arch-08 surface principle) while letting each edge speak its natural protocol. Deliberately adopting seven of A2A v1.0's eight concrete task states buys a narrow future adapter without importing edge authentication semantics into an internal no-trust-boundary call; that adapter must map A2A's additional `auth-required` state. The native binding avoids MCP loopback serialization for in-process consumers, and `input-required` provides the two-way conversation seam every binding shares. |
| **Re-evaluate when** | An external org actually needs multi-turn task-driving against hosted agents (activate the A2A binding); A2A post-v1.0 diverges from the internal seven-state subset; or an internal consumer demonstrates a need the native binding cannot express through the one contract. |

---

## 23. Multi-agent Docker host is the first deployment topology

> **Superseded by Decisions 25, 26, and 28.** PR #794 removed AgentHost.
> Current topology is an application Agent fleet orchestrated by Workspace over
> governed Environment services; no Docker host controller or compiled bundle
> topology is implied.

| Field | |
|---|---|
| **Status** | **Accepted (2026-07-12)** — the pre-dispatch gate is satisfied: the amendment landed with the reconciled pack (#649) and P6-R merged (#647). |
| **What** | The first production topology is one EU Docker image/compose deployment hosting N distinct compiled agent bundles mapped through authorized workspaces. Each configured exact hostname selects bounded landing/site state, then normal authentication and membership resolve one workspace; that workspace's deployed agent is selected as `default`. Hostname selection grants no workspace authority. A dedicated tenant VM runs the same artifact as deployment variant 2, not as a code fork or prerequisite for the first path. P6-R and agent-host use the existing approved workspace/runtime composition; P2 provider extraction and X1 mounts are later and do not gate them. |
| **Why** | The product priority is reducing time to ship and operate many specific agents. Requiring one deployment and a new runsc/provider path per agent front-loads infrastructure, duplicates host lifecycle, and prevents validating the generic definition/deployment/workspace binding at useful density. |
| **Rationale** | Decision 21 already makes the authorized workspace the runtime and policy authority. Repeating that binding N times inside one host reuses the existing security boundary and keeps `AgentDefinition` portable, while exact-host landing remains a surface mapping rather than an authorization mechanism. The dedicated-VM shape remains available from the same artifact for customers who require stronger infrastructure isolation. This supersedes decision 19a's dedicated-only v1 topology and any P2 -> P5a -> P6-R/agent-host dependency where they conflict; it does not weaken workspace authorization or create D2's wildcard tenant control plane. |
| **Re-evaluate when** | Measured host isolation or capacity cannot satisfy the first deployments; a customer contract requires a dedicated VM; or repeated tenant lifecycle/control-plane needs justify D2. Re-evaluation chooses a deployment composition, not a second agent runtime architecture. |

---

## 24. Identity server: Ory Hydra + boring-owned adapter layer

| Field | |
|---|---|
| **Status** | **Accepted (2026-07-12, merged via #670).** |
| **What** | Hydra v2.x is selected as the identity server for ID1 (OAuth 2.1 + PKCE proven live in spike; ~42MB image). Boring owns the RFC 9728 protected-resource-metadata endpoint, resource-vs-audience validation (reject cross-resource token reuse), and CIMD handling regardless of which server is chosen. |
| **Why** | ID1 needs a proven, low-footprint OAuth 2.1/PKCE identity server that can be hosted inside the agent-host compose deployment without requiring a heavyweight standalone service. |
| **Rationale** | Keycloak merged initial experimental RFC 8707 support on 2026-03-17 ([PR #46763](https://github.com/keycloak/keycloak/pull/46763)); [#41526](https://github.com/keycloak/keycloak/issues/41526) is closed and follow-up [#47117](https://github.com/keycloak/keycloak/issues/47117) remains open. The decisive factors remain footprint (Ory's documented 5–15 MB Go binary range versus a 750 MB+ JVM footprint) and our live Hydra PKCE spike. An adapter layer is required either way: boring must implement RFC 9728, resource-vs-audience validation, and CIMD. See [`SPIKE-EVIDENCE-2026-07-11.md`](issues/391/runtime-refactor/SPIKE-EVIDENCE-2026-07-11.md) §3/§5. |
| **Re-evaluate when** | Keycloak's RFC 8707 support is stable **and** CIMD becomes required. |

## 25. Static multi-agent composition after AgentHost removal

> **Sequencing and shared-runtime topology superseded by Decision 28.** Retain
> static/no-controller composition, consumer authorization, actor-neutral Agent
> identity, and full-app compatibility. Workspace now orchestrates a static fleet
> over a governed Environment service and persists its default Agent.

| Field | |
|---|---|
| **Status** | **Accepted (2026-07-17).** Owner-directed in the #391 planning session; encoded and reviewed by the canonical plan-reset PR. |
| **What** | After PR [#794](https://github.com/hachej/boring-ui/pull/794) physically removed obsolete AgentHost assets, #391 proceeds package-first. A host supplies an immutable startup set of static agent declarations plus trusted server-only behavior bindings. Existing definition/deployment data may be immutable provenance but never runtime resolution authority. Core authenticates and verifies workspace membership before selecting one configured agent. Logical agents attach to the existing sole workspace-keyed `Workspace` + `Sandbox` lifecycle; agents in that workspace intentionally share filesystem/process/runtime authority while retaining distinct route, prompt, tool, session, readiness, receipt, log, and provenance identity. Existing unscoped routes map to one primary agent; optional safe catalog exposure defaults off; full-app remains one hidden primary; Seneca is qualified with package tarballs before the exact release and is the first two-agent consumer after it. The canonical plan is [`issues/391/plan.md`](issues/391/plan.md). |
| **Why** | The AgentHost/controller/revision/publication/content-addressed-store path created deployment and control-plane complexity before proving the simpler product need: statically composing multiple named agents over the existing authorized workspace runtime. The owner chose a clean base and a consumer-led implementation sequence. |
| **Rationale** | Static startup composition adds no mutation lifecycle or persistent registry. Reusing Core authorization and the existing Workspace/Sandbox pair avoids a second authority or runtime owner. Explicitly treating same-workspace agents as one trust domain prevents tool-list or session separation from being misrepresented as filesystem isolation. Full-app protects compatibility while Seneca forces the reusable package seam through a real external consumer. Existing `AgentDefinition`/compiler/resolver APIs remain until a separate published-consumer and semver audit justifies change; immutable identity does not imply a deployment/publication content-addressed store. |
| **Supersedes / defers** | Supersedes Decision 19a's AgentHost delivery path and Decision 23's Docker-host-first topology. Retains Decision 19's layering, Decision 21's workspace-first authorization, and Decision 22's protocol-at-edges principle. Defers Decision 22's native/contracted implementation sequencing, custom JSON tools, A2A, durable transport, marketplace, generic environment, provider extraction, mounts, per-agent isolation, dynamic registration, and control-plane UX until after the Seneca proof and separate approved plans. |
| **Re-evaluate when** | A named consumer requires runtime mutation, per-agent isolation, or cross-workspace delegation and provides explicit auth, lifecycle, persistence, session, rollback, and proof requirements. Re-evaluation cannot silently restore deleted AgentHost assets or create a second workspace/runtime authority. |

## 26. Domain-routed typed Workspaces with Workspace-owned agent orchestration

> **Superseded by Decision 28 for active topology and sequencing.** Retain
> Workspace-first authorization, ordinary membership-before-effects, static
> trusted composition, declarative authored source, actor-neutral typed Agent
> applications, protocol-at-edges, session/history compatibility, and rejection
> of AgentHost/controllers/mutable registries/second composers. Decision 28
> replaces domain-selected persisted Workspace type and per-type default/allowed
> policy with an application agent fleet plus a Workspace-persisted default.
> Domain is signup initialization only.

| Field | |
|---|---|
| **Status** | **Accepted (2026-07-17; ownership/multi-agent foundation clarified 2026-07-20).** Owner-directed in the #391 planning sessions after the Decision 25 reset. |
| **What** | #391 ships in product-led steps. **Step 1A:** exact trusted domain → persisted `workspaceTypeId` → authenticated membership-authorized Workspace → Workspace-selected default agent. Core owns authentication, membership, Workspace persistence, and typed list/select/create; it does not load or compose agents. Workspace owns deployment-static `defaultAgentTypeId` + `allowedAgentTypeIds`, one shared WorkspaceRuntime/Workspace/Sandbox, effective provisioning-plugin union, and a lazy actor-neutral singleton per `(workspaceId, agentTypeId)`. Agent loads/executes one requested type against that supplied runtime. The backend proves two allowed types share exact Workspace/Sandbox identity now, while public human ingress starts new sessions with only the default and accepts no arbitrary agent selector. Existing hosts normalize through the same orchestrator as `default → primary`. Authored agent data is declarative identity/safe metadata/instructions only; trusted host plugins own executable behavior. **Step 1B:** authenticated external MCP reaches the same authorized Workspace and server-selected default. **Step 2:** activate Workspace-local native collaboration after a `pi-subagents` executor/backend can share WorkspaceRuntime; human selector/switch/fork remains a separate product decision. **Step 3:** durable task/events, replay/approvals/recovery, external A2A, hardened transports, runtime extraction, custom sandbox tools, and channels follow named consumers. Contracted agents later use explicit separate Workspaces, governed readonly projections, and returned artifacts. The canonical plan is [`issues/391/plan.md`](issues/391/plan.md); A1/runtime details are in [`issues/805/runtime-refactor/work/A1-agent-authoring/PLAN.md`](issues/805/runtime-refactor/work/A1-agent-authoring/PLAN.md). |
| **Why** | The immediate product is several focused Workspace products reached by domain, not a human agent catalog. Persisted Workspace type makes product identity independent of hostname and reusable by UI/MCP/A2A. Building the typed singleton/shared-runtime substrate now prevents the default-agent shipment from cementing a second singular runtime design, while keeping selectors and collaboration out of the first UX. Separating Core authorization, Workspace orchestration, and one-type Agent execution prevents Core from becoming an executable behavior registry. |
| **Rationale** | A static Workspace-ID map would require deployment on every creation; a mutable classifier could silently change product identity. Deployment-static type/default/allowed-agent declarations are auditable and need no registry/controller or AgentHost deployment/publication content-addressed store. One WorkspaceRuntime plus typed AgentBindings preserves the Workspace as security/provisioning boundary: plugin/tool differences are behavior, never isolation. New sessions persist trusted agent type; legacy sessions without it use the current default and reviewed history is not rewritten. All host-selected static source/plugin/policy references validate at host startup, but WorkspaceRuntime and AgentBindings remain lazy. Workspace/Sandbox creation failure affects the Workspace; background provisioning failure is one shared degraded-readiness state that preserves current non-runtime chat behavior; one agent load failure is isolated and retryable. Authored JSON never selects executable packages, tools, credentials, MCP commands, models, or runtime policy. Tool collisions retain current deterministic non-fatal Boring/Pi behavior. `agent dev` launches the regular server. A future Boring Pi package may adapt arbitrary Pi agents, but it cannot own auth, Workspace policy, server routes, persistence, provisioning, or the shared runtime lifecycle. Same-process collaboration stays native; A2A remains external. |
| **Supersedes / retains** | Supersedes Decision 25's same-workspace-first product ordering, the Step 1A singular `workspaceType → one agent` backend shape, Core-owned agent behavior resolution, authored tool catalogs, and a separate authored-agent dev app. Retains Decision 19's package-layering/EU principles, Decision 21's Workspace-first authorization, Decision 22's protocol-at-edges/contracted-projection principles, and Decision 25's rejection of AgentHost deployment/publication content-addressed storage, mutable registries, and second runtime composers. |
| **Re-evaluate when** | A real consumer cannot model product identity as persisted Workspace type; explicit Workspace reassignment is required; actor-neutral typed singletons cannot preserve a supported authorization contract; a human selector/switch/fork becomes a named product need; external tasks require restart-safe multi-turn work; or third parties contract agents. Re-evaluation cannot make hostname/agent identity an authority, restore AgentHost deployment/publication content-addressed storage, treat plugin assignment as route authorization, create implicit Workspaces during delegation, add live cross-Workspace ACL grants, or force same-process calls through A2A loopback. |

## 27. Workspace-scoped provider credentials and BYOK before platform-billed model keys

> **Current scope under Decision 28:** retain encrypted per-Workspace provider-
> credential custody, membership-before-resolution for web, fail-closed
> unreadable-key behavior, and no shell/filesystem/session/log exposure. Remove
> Workspace-type validation and exact shared-Sandbox assumptions. Trusted
> consumers receive only execution-scoped credential material or capability;
> model providers use distinct Core/web and CLI `ModelCapabilityIssuer`
> adapters, and cached AgentApplications never capture reusable credentials.

| Field | |
|---|---|
| **Status** | **Accepted (2026-07-19; dedicated credential-vault custody amended and ratified 2026-07-20).** Owner-directed in the #391 planning session for [#820](https://github.com/hachej/boring-ui/issues/820). |
| **What** | V1 uses one generic workspace-scoped provider-credential system for LLM/chat, search, transcription, MCP, plugins, first-party tools, tenant custom tools, and future registered providers; model credentials use BYOK per Workspace. Hosted custody stays in the Core/control-plane and uses the dedicated credential-vault schema `workspaceCredentialKeys`, `workspaceProviderCredentials`, and `workspaceProviderCredentialFields`, not encrypted `workspace_settings`. Each Workspace has a 256-bit DEK; credential fields use AAD-bound AES-256-GCM envelopes, and a fail-closed `KmsBackend` wraps or unwraps the DEK. OVHcloud KMS is the default managed-EU backend and a sealed-file local KEK is the explicit development/self-host fallback; selection never silently probes or falls back to another backend. A tenant credential is resolved only after web authentication plus Workspace membership and delivered only to an authorized trusted consumer for one execution; client/list APIs remain write-only or masked and expose no plaintext read. It is never captured by a reusable AgentApplication, written to sessions/tasks/events/logs/filesystems, forwarded to general shell/Environment executions, or baked into an image, Agent definition, or deployment artifact. Model calls receive an opaque invocation-scoped model client/capability, and CLI supplies its own trusted-local adapter without Core. The instance-level `ANTHROPIC_API_KEY` remains an explicit self-host/model-provider fallback only when that Workspace/provider is in `instance_fallback_enabled`; `intentionally_absent`, disabled, revoked, unreadable, and non-model credentials never fall back. Ambient Pi auth files/OAuth are not a hosted-Workspace payer fallback. Platform-billed pooled keys are deferred to #809/BL1 after #819 supplies metering. |
| **Why** | One credential lifecycle and custody boundary avoids parallel model, MCP, plugin, and tool secret stores with inconsistent authority or isolation. One instance model key also cannot safely or accountably pay for unrelated tenant workspaces before billing, budgets, and per-workspace usage evidence exist. The credential-owner and key-payer policies must be fixed before the SaaS tier because retrofitting them after tenants and sessions exist would be expensive and leak-prone. |
| **Rationale** | Dedicated metadata, field-envelope, and wrapped-DEK tables make workspace/provider/version isolation, rotation, fallback suppression, and ciphertext-only inspection explicit instead of encoding credentials as opaque generic settings. Per-Workspace DEKs bound to canonical workspace/credential/provider/field/version/generation AAD reject cross-tenant or cross-field substitution; the pluggable KEK boundary supports managed-EU custody while retaining a sealed-file local option without changing envelope crypto. Registered trusted consumers share the same host-side one-execution resolution boundary without receiving a general plaintext API. For models, a trusted Core/web `ModelCapabilityIssuer` gives each hosted Workspace one explicit payer without making Workspace or Agent own custody, and configures one opaque model client per invocation. Explicit `instance_fallback_enabled` may use the self-host model key; a durable `intentionally_absent` tombstone remains `CREDENTIAL_REVOKED`, and configured-but-unreadable BYOK also fails closed rather than silently charging the instance. CLI uses a separate trusted-local issuer and never boots Core. No new event bus is introduced: later credential-usage or billing events use #807 T1, and #819 owns metering facts. #820 must align its code seam/proof chain to Decision 28 before dispatch. |
| **Supersedes / retains** | Supersedes both the implicit assumption that one instance provider key is the payer for every hosted tenant Workspace and the earlier note that v1 BYOK reuses encrypted `workspace_settings`. Retains package-layering/EU principles, Core/control-plane hosted custody, Workspace-first web authorization, Decision 28's static fleet and invocation-scoped authority, and rejection of AgentHost, controllers, deployment content stores/publication journals, mutable runtime registries, and second composers. Decision 28 supersedes the old Workspace-type and exact shared-Sandbox wording. |
| **Re-evaluate when** | #819 per-workspace metering has landed and #809/BL1 is approved to fund platform-billed pooled keys; a named provider cannot use a per-execution credential; or an approved external secret manager is required for rotation/compliance. Re-evaluation may replace the custody adapter, but cannot put keys in images/bundles, expose plaintext to clients or general tool sandboxes, bypass workspace authorization, or restore forbidden runtime/control-plane machinery. |

## 28. Application agent fleets, Workspace orchestration, and shared execution environments

| Field | |
|---|---|
| **Status** | **Accepted (2026-07-21).** Owner-directed #391/#805 realignment after reviewing the domain/type implementation and restating the platform as a fleet of agent applications. |
| **What** | A host application defines one deployment-static **agent fleet**: stable `agentTypeId` values, declarative authored sources, and trusted host-owned behavior/plugin bindings. CLI YAML expresses the same semantic fleet through an independent adapter. Core/web and CLI consume Workspace independently; neither is routed through the other. Every initialized Workspace durably persists `defaultAgentTypeId`, which must resolve to the current app fleet before execution. An exact trusted signup-domain mapping may initialize that value for a newly created default Workspace, but domain has no continuing routing, membership, selection, or authorization effect and never rewrites an existing Workspace. Workspace bundles and orchestrates service-shaped Agent applications, initially in process. Agent executes one fleet application and receives a governed execution-environment lease. `@hachej/boring-bash` owns the transport-neutral Environment service contract—coherent files/search/watch/exec over one canonical Workspace filesystem—and composes `@hachej/boring-sandbox`'s Agent/Workspace-neutral isolation/provider backend. Governance plugins compile authorized invocation context into attenuated Environment admission; Agents receive operations/capabilities, not policy sources, membership records, or Sandbox administration. |
| **Why** | Agent availability is an application/deployment fact; the selected default is durable Workspace state; domain is only acquisition/onboarding intent. Persisting the default keeps UI, CLI, MCP, and later surfaces consistent after signup without inventing product membership or permanently classifying a Workspace by hostname. Core/web and CLI need the same Workspace orchestration but have different identity, persistence, and lifecycle adapters. A service-shaped in-process boundary keeps current delivery simple while preserving future remote Agent and Environment adapters. One Environment API for Agent tools, bash, UI, and CLI prevents host-versus-Sandbox filesystem split brain. |
| **Rationale** | A `workspaceTypeId → defaultAgentTypeId + allowedAgentTypeIds` graph duplicates fleet configuration and turns signup routing into permanent product partition. The application fleet is copied, frozen, and fully validated before serving; changing it requires deploy/restart, not a registry/controller. Workspace validates its persisted default and fails stably without silent fallback when the deployed fleet no longer contains it. Same-Workspace first-party Agents share logical Workspace data through the canonical Environment API; compatible governance/runtime grants may reuse one environment, while narrower grants receive separately enforced execution views without copying the authoritative filesystem. `boring-bash` owns consumer-visible operation semantics and coherence; `boring-sandbox` owns confinement/provider mechanics and must not depend on Core, Workspace, or Agent identities. Existing `workspaceTypeId` data may remain temporary compatibility metadata pinned to `default`, but it has no Agent-selection, membership, routing, provisioning, session, or cache authority. |
| **Supersedes / retains** | Supersedes Decision 26's domain-routed typed-Workspace topology, Core typed list/select/create track, Workspace-type default/allowed policy, exact shared `WorkspaceRuntime + Sandbox` object-identity requirement across Agent types, and combined-host R1–R6 dispatch graph. Retains Decisions 19/21/22 and compatible parts of Decisions 25/26: package layering and EU/self-hostability; ordinary Workspace membership before effects; static/no-controller composition; declarative source plus trusted executable plugins; actor-neutral Agent identity; session/history compatibility; protocol bindings at edges; governed contracted projections; and rejection of AgentHost, deployment/publication content-addressed storage, mutable registries, authored executable catalogs, and second behavior composers. |
| **Re-evaluate when** | A named product needs public default changes, per-Workspace fleet allowlists, remote Agent deployment, remote Environment transport, per-Agent copied workspaces, stronger isolation than execution views, cross-Workspace delegation, or restart-safe external tasks. Re-evaluation must specify authorization, persistence, filesystem authority, governance enforcement, session migration, rollout, rollback, and proof. It cannot let signup domain/Agent identity/Environment capability grant membership, silently rewrite a persisted Workspace default, couple Core and CLI through each other, let an Agent mint its own Environment authority, create competing authoritative file trees, or restore AgentHost/controller/publication machinery. |

## Process

1. Any PR that changes a locked decision **must** update this document.
2. The PR description must include rationale for the change.
3. Reviewers check DECISIONS.md for drift from the codebase.
4. To propose a new locked decision, add it here with all four fields and get team sign-off.
5. PRs that merge a Proposed decision must flip its status in the same PR — "accepted on merge" wording is banned (it failed to flip three times on 2026-07-11/12).

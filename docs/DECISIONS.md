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

| Field | |
|---|---|
| **What** | Ratify the #391 v2 plan pack: `@hachej/boring-agent` becomes the headless model/session/tool core with zero value imports from `@hachej/boring-bash` or `@hachej/boring-sandbox`; `@hachej/boring-bash` owns the optional fs+exec runtime, file routes/tools/UI, bash requirement normalization, and runtime-mode resolution; `@hachej/boring-sandbox` owns concrete providers, FUSE-S3 mounts, lifecycle, and capability facts; workspace UI, Slack, spreadsheet, CLI, and future surfaces are thin ingress/egress adapters over one event-stream contract. Source paths: docs/issues/391/runtime-refactor/README.md docs/issues/391/runtime-refactor/architecture/00-global-isa.md (package ownership table, Direction, North star, invariant 15) docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md docs/issues/391/runtime-refactor/architecture/09-environments-attachable.md <br><br>Locked decision statuses: <ol><li>Wire protocol — status: decided; source: 08 decision 1; cross-reference: §3. Keep `PiChatEvent` as the v1 payload, wrap it in the indexed `AgentEvent` envelope, and do not create a parallel event union.</li><li>Pure mode — status: decided; source: 08 decision 2 and 00 open decision 1. Use pi-coding-agent with `runtime: 'none'` and sealed cwd behind the Phase 1 audit; no second harness.</li><li>Surfaces outside the agent package — status: decided; source: 08 decision 3. Channel/surface packages follow the Flue-style package model rather than `boring-agent` subpaths.</li><li>Readonly fs is v1 — status: decided landed; source: 08 decision 4. The #416 readonly filesystem work resolves 00 open decision 6.</li><li>One-namespace rule superseded — status: decided superseded; source: 08 decision 5. Named `(filesystem, path)` bindings from #416 replace the single-namespace rule.</li><li>Channel ingress reused — status: decided; source: 08 decision 6. Use pinned `@flue/*` ingress packages with thin adapters; vendoring is only the fallback and hosting inside Flue's runtime is not adopted.</li><li>Environments attachable — status: decided; source: 08 decision 7 and 09. A filesystem plus sandbox has identity independent of any agent; agents, subagents, and external agents attach, with external access via MCP projection.</li><li>Front chat provider unchanged — status: decided with view-model migration deferred; source: 08 decision 8. Keep the current UI/provider projection; the deferred work is migrating the `PiChatEvent` reducer/view-model to native `UIMessage` and tool-approval parts.</li><li>No feature-flag framework — status: decided; source: 08 decision 9. Protocol/version change rides `AgentEvent.v`, additive DS routes during T1/T2, injectable front transport during cutover, and minor package bumps at T2/P3.</li><li>No retro-compat and no speculative abstraction — status: decided; source: 08 decision 10 and INDEX simplicity policy. Importers migrate in the same PR, temporary code names its deletion bead, and abstractions require real consumers.</li><li>Three-package runtime stack — status: decided; source: 08 decision 11 and 00 open decision 3. `boring-agent` defines contracts and imports neither runtime package; `boring-bash` is THE RUNTIME and imports sandbox values plus agent types; `boring-sandbox` owns providers, mounts, lifecycle, and capability facts with agent type-only imports.</li><li>v2 north star — status: decided for this epic's substrate; source: 00 North star and VISION North star. Eve-class declarative authoring, workspace-as-farm-control-plane, open foreign-agent integration, and Flue internals are the direction; agent-as-directory authoring and the farm UI remain explicitly deferred follow-ups.</li><li>EU-sovereign defaults — status: decided; source: 00 invariant 15 and VISION row 8. Defaults must be self-hostable on EU infrastructure; US-hosted providers such as `vercel-sandbox` stay optional behind the capability matrix.</li></ol>Deferred carryover from 00: <ol><li>Provisioning sharing defaults — status: deferred; owner phases: P5 provisioning/readiness and P6a AgentRegistry requirements; source: 00 open decision 5.</li><li>Surface addressing-store persistence — status: deferred; owner phases: T2 transport, S1/S2 concrete surface stores, and P7 agent scoping; source: 00 open decision 7 and 08 two-handles rule.</li></ol> |
| **Why** | The current agent docs and runtime decisions still assume Workspace+Sandbox+FileSearch as an agent baseline. That blocks true headless agents, non-workspace surfaces, spreadsheet embeds, Slack channels, and the farm/control-plane direction while also making the future `@hachej/boring-agent` package vulnerable to runtime import cycles. |
| **Rationale** | The v2 pack makes the plan pack the canonical design record and keeps this registry as the durable ratification surface. The five-layer model from 00 — Surfaces, Transport, Agent core, Features, Runtime — separates message ingress, replayable event transport, the model/session/tool loop, optional bash/file/UI features, and concrete providers. This preserves the existing workspace experience while making `runtime: 'none'` first-class and keeping boring-bash-active no-split-brain rules local to attached environments. |
| **Re-evaluate when** | The deferred `PiChatEvent` reducer/view-model migration to native `UIMessage` and tool-approval parts lands; a second real non-workspace surface proves the public contract needs a shape change; EU-hosted defaults cannot satisfy a required platform component; or the deferred 00 decisions above close and require narrowing this ratification. |

---

## 19a. #391 ships a dedicated agent-factory v1 before platform expansion

| Field | |
|---|---|
| **What** | Amend decision 19 without replacing its long-term direction. #391 ships incrementally. Release 0 is a bearer-authenticated managed-MCP tracer with bounded self-contained output. V1 compiles a minimal agent directory to a self-contained content-addressed bundle containing a versioned behavior-only `AgentDefinition` and immutable assets, combines it with a separately versioned tenant/runtime `AgentDeployment`, records definition/deployment/resolved-snapshot digests on sessions, and delivers the same bundle through one dedicated EU deployment path. Events, pending approvals, waiting state, and authenticated-subject-scoped caller receipts share one SQLite `agent.db`. Authority is calculated from provider facts and policy/grants; requirements only validate active authority. D1 uses a fenced crash-safe apply journal and is the sole v1 topology. P4, E2, X1/FUSE, P5 advanced services, P6 plugin/child-app expansion, P7, M2, D2, and S3/S4 are post-v1. |
| **Why** | The prior plan could complete a large substrate while deferring the stated product goal of quickly authoring and shipping an agent. It also coupled reusable behavior to pricing/deployment/tenancy, split one approval transition across two SQLite files, mixed requirements into the authority algebra, and required speculative FUSE/control-plane work before a dedicated delivery path. |
| **Rationale** | Two real consumers justify the small definition boundary immediately: local development and D1 deployment. A separate deployment object keeps reusable behavior portable. One SQLite transaction removes the event/pending-state crash window. Dedicated tenancy gives a strong isolation baseline without inventing a shared tenant authority. Later capabilities retain their plans but earn implementation through a concrete consumer and separate exit. |
| **Re-evaluate when** | D1 has repeated enough to justify shared tenancy; a second host needs the full filesystem presentation bundle; a native-mount consumer proves X1; multi-instance load requires Postgres; or a durable waiting-turn journal is required for restart continuation. |

---

## 20. Company-admin front surface: single app-composed provider slot, no plugin self-registration

| Field | |
|---|---|
| **What** | Core front exposes exactly one optional, declarative admin-surface slot: `CoreFront`'s `companyAdmin?: { loadStatus, renderContent, labels? }` prop, threaded through `CompanyAdminProvider`. The app composes it (e.g. full-app passes `createGovernanceCompanyAdmin()` from `@hachej/boring-governance/front`); plugins never register themselves into core front. With no provider configured — or a provider reporting `enabled !== true` / `admin !== true` — core renders **no trace** of the surface: no `UserMenu` entry, and the admin route navigates away. Core contains zero governance vocabulary (enforced by review grep: `grep -ri governance packages/core/src` must be empty). |
| **Why** | Core must stay generic: it knows "an admin surface descriptor was provided", never which plugin provided it. App-side composition (props, not a registry) makes ordering and conflicts a non-problem — the app decides explicitly in readable code, matching how the server seams compose (`plugins`, `filterModels`, `metering`, `getFilesystemBindings` are also app-spread). The workspace-pane plugin system is not reused because admin surfaces are app-level routes gated on a different axis (company admin) than workspace panes (workspace membership); conflating the two lifecycles would be wrong. |
| **Rationale** | v1 has exactly one consumer (boring-governance), so a multi-surface registry would be designed from a single example — the descriptor shape `{ loadStatus, renderContent, labels }` was instead made self-describing so pluralizing is mechanical. Designing a generic slot from one example risks wrong abstractions (composition order, deep-linking, per-section gating are unknowable without a second consumer). |
| **Re-evaluate when** | A second plugin needs an admin/workspace-management surface. Planned evolution: `companyAdmin` becomes `adminSections: Section[]` (same descriptor shape, plus an `id` for deep-linking); the admin page hosts one tab per section whose `loadStatus` reports `admin: true`; app array order is authoritative for display order; still no dynamic registration. |

## Process

1. Any PR that changes a locked decision **must** update this document.
2. The PR description must include rationale for the change.
3. Reviewers check DECISIONS.md for drift from the codebase.
4. To propose a new locked decision, add it here with all four fields and get team sign-off.

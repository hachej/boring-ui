> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# Boring Bash runtime-free agents — TODO/bead plan pack

Status: first generated TODO pass. Must pass thermo review before creating real `br` beads or implementation PRs.

TODO-01's pure-mode beads (BBA-012/013/014) are superseded by [Decision 21](../../../../DECISIONS.md#21-workspace-first-agent-factory-v1-supersedes-public-pure-mode) — do not implement; see the banner in [`TODO-01-agent-core-pure-mode.md`](TODO-01-agent-core-pure-mode.md).

These TODO files plus this README are intentionally self-contained. A future implementer should not need to read the markdown architecture plan first, but every future real `br` bead should copy the relevant excerpts from this TODO pack into its own description and cite the source TODO id.

## Source plan pack

- `../00-global-isa.md`
- `../01-agent-core-runtime-free.md`
- `../02-boring-bash-environment.md`
- `../03-policy-provisioning-readiness.md`
- `../04-plugin-child-app-runtime.md`
- `../05-multi-agent-sessions-hooks.md`
- `../06-migration-phases.md`
- `../07-tests-review-acceptance.md`

## TODO files

1. [`TODO-00-foundation-adr.md`](TODO-00-foundation-adr.md) — ADRs, package ownership, invariant updates, review gates.
2. [`TODO-01-agent-core-pure-mode.md`](TODO-01-agent-core-pure-mode.md) — dependency inversion, pure no-filesystem agent, pi audit, operational hooks.
3. [`TODO-02-boring-bash-package-providers.md`](TODO-02-boring-bash-package-providers.md) — package skeleton, providers, capability matrix, remote-worker split.
4. [`TODO-03-routes-tools-ui.md`](TODO-03-routes-tools-ui.md) — routes/tools/UI plugin extraction, file tree provider, document authority.
5. [`TODO-04-policy-provisioning-readiness.md`](TODO-04-policy-provisioning-readiness.md) — requirements, policy stack, provisioning, readiness, secrets, services.
6. [`TODO-05-plugins-child-app-runtime.md`](TODO-05-plugins-child-app-runtime.md) — plugin manifests, hosted plugins, child-app/Macro scoping, full-app reload.
7. [`TODO-06-multi-agent-sessions-hooks.md`](TODO-06-multi-agent-sessions-hooks.md) — AgentRegistry, agentId routing, sessions/search, external hooks.
8. [`TODO-07-cleanup-release.md`](TODO-07-cleanup-release.md) — compatibility removal, docs, issue closure, release validation.

## Key contract excerpts to copy into real beads

### Agent feature façade

```ts
interface AgentEnvironment {
  sessionStorageRoot: string
  workspaceId?: string
  agentId?: string
  featureGrants?: Record<string, unknown>
}

interface AgentFeature {
  id: string
  tools?(ctx: AgentFeatureContext): AgentTool[] | Promise<AgentTool[]>
  systemPrompt?(ctx: AgentFeatureContext): string | undefined | Promise<string | undefined>
  readinessRequirements?: string[]
}

interface AgentServerFeature extends AgentFeature {
  routes?(ctx: AgentFeatureContext): FastifyPluginAsync | undefined
}
```

`AgentFeature` is a façade over existing tool/route/systemPrompt/capability contributors, not a second plugin system.

### Bash provider capability facts

Providers must declare fs mode, exec, real bash, real binaries, network isolation, watch/search, persistence, and provisioning support. Runtime mode ids and provider ids differ: `local` mode maps to `bwrap` provider.

### Bash environment summary

```ts
interface BashEnvironment {
  id: string
  provider: 'direct' | 'bwrap' | 'vercel-sandbox' | 'remote-worker' | string
  runtimeCwd: string
  fs?: BashFs
  exec?: BashExec
  search?: BashSearch
  watch?: BashWatch
  provisioning?: BashProvisioningState
  providerCapabilities: BashProviderCapabilities
}
```

### Bash requirement normalizer

`@hachej/boring-bash` owns requirement normalization and provider adapters. `@hachej/boring-agent` owns the existing provisioning engine over injected adapters. Host/core/CLI wires the two together.

### Source-of-truth invariant

For any active boring-bash environment, file routes, file tree, search/watch, bash, git/status, and model-visible cwd must share one source of truth.

## Global dependency graph

```txt
BBA-000 foundation ADR/review gates
  ├─> BBA-006 open decisions gate
  ├─> BBA-010 dependency inversion + pure mode
  │     ├─> BBA-020 boring-bash package/providers
  │     │     ├─> BBA-030 routes/tools/UI extraction
  │     │     │     ├─> BBA-037 source-of-truth model
  │     │     │     │     └─> BBA-026 route-level source-of-truth regression
  │     │     ├─> BBA-040 policy/provisioning/readiness
  │     │     │     ├─> BBA-047 two-phase lifecycle/fingerprints
  │     │     │     ├─> BBA-050 plugins/child-app/runtime services
  │     │     │     └─> BBA-060 multi-agent/session/search/hooks
  │     │     └─> BBA-070 cleanup/release
  │     └─> BBA-060 multi-agent/session/search/hooks
  └─> BBA-070 cleanup/release
```

## Global hard rules embedded into every task

- Never work directly on `main` unless explicitly authorized.
- No file deletion without explicit written permission.
- No destructive git/filesystem ops.
- No secrets in git/logs/prompts/issues.
- Do not edit `.beads/*.jsonl` by hand; when converting to real beads, use `br` only.
- Never launch bare `bv`; use `bv --robot-*` only.
- Session history is host app user data: use host durable `BORING_AGENT_SESSION_ROOT`, normally `/data/pi-sessions`, not workspace/container home.
- Preserve architectural invariants: no `node:*` or `Buffer` in shared code, routes/tools receive `Workspace`, path validation belongs to adapters, UI dispatch goes through `UiBridge.postCommand`, workspace base front/shared has no value import from agent, every error has stable code, pi file/shell tools flow through factories/adapters.

## Review checklist for TODO pack

- Every task has dependencies.
- Every task is self-contained with why/context.
- Every task has unit tests and e2e/smoke proof where applicable, with detailed structured logging.
- Tests require detailed logging for mode/provider/workspace/agent/session ids.
- No task creates package cycles.
- No task creates parallel provisioning/readiness systems.
- No task overclaims unrelated backlog issue closure.

# A1 executable TODO map

> [`PLAN.md`](PLAN.md) is authoritative. This file becomes dispatchable only
> after PR #846 merges and replacement Beads are created.

## R0 — authority and audit

- [ ] Recheck #813–#817/#821/Seneca #16 status and merge ancestry.
- [ ] Record npm publication cohort and every affected export/error/CLI field.
- [ ] Inventory repository, packed-package, and Seneca consumers.
- [ ] Inventory every runtime cache-key contributor, global capabilities tool
  list, and actor/request-sensitive root/template/tool/Pi/bridge/session callback.
- [ ] Record the complete legacy option → runtime/agent/invocation mapping.
- [ ] Align Decision 26, #391 docs, #805 plan, PLAN/HANDOFF/TODO and mark stale
  P3 tool-catalog/custom-tool authority non-dispatchable pending recut.
- [ ] Replace old `wt-391-forward-c0u` dispatch graph after plan approval.
- [ ] Run `br lint`, `br dep cycles`, and `bv --robot-insights`.

## R1 — WorkspaceRuntime / AgentBinding split

- [ ] Introduce explicit WorkspaceRuntime primitive over the current runtime
  bundle.
- [ ] Add one embeddable WorkspaceAgentHost used by standalone, Core, and CLI
  workspaces-mode shells.
- [ ] Make Workspace own a `workspaceId`-only runtime cache/lifecycle and reject
  workspace-static descriptor drift.
- [ ] Make Agent factory consume an existing runtime and one behavior input.
- [ ] Normalize omitted policy to `default → primary` internally.
- [ ] Preserve lazy loading and concurrency dedupe; add staged adapter rollback,
  background-run scope leases, generation-safe reload/readiness, and disposal.
- [ ] Prove active work survives LRU pressure; 256 passive streams close with
  cursor/reconnect to admit workspace 257; all-active capacity fails promptly.
- [ ] Add idempotent authorized `retireWorkspace`; migrate CLI remove/re-add and
  prove passive/active work, timeout/destroy failure, and exact-once cleanup.
- [ ] Remove CLI workspaces mode's direct `registerAgentRoutes`, plugin runtime/
  backend registry, and provisioning ownership; route all three hosts through
  the same orchestrator.
- [ ] Add a repository gate forbidding parallel host resource owners.
- [ ] Prove current full-app/standalone capture compatibility.

## R2a — actor-neutral session/binding façade

- [ ] Expose a narrowed Workspace-hosted AgentBinding façade; keep raw objects
  unreachable from it while preserving supported standalone package exports
  unless R0 approves a separate semver migration.
- [ ] Add Workspace-visible actor-multiplexing router over existing session
  stores while preserving old user namespace directories.
- [ ] Privately mint/validate Workspace+actor+session+type handles and stable
  private session-state keys for every harness/store/plugin/diagnostic/change/
  command API; migrate ask-user data with ownership proof and delete scoped
  plugin state without executable type validation.
- [ ] Extend existing session metadata/context with trusted `agentTypeId`.
- [ ] New execution uses default/legacy rules; malformed/conflicting/disallowed
  type fails before binding creation while history/state/attachment/changes/
  delete remain ownership-authorized through `resolveForHistory`.
- [ ] Add exhaustive invocation-strategy route/dispatcher manifest and
  registration conformance.
- [ ] Enforce command/extension-driven create/open/switch/fork/delete through
  the session controller.
- [ ] Refactor actor-capturing tools and stateful plugins (ask-user, automation,
  governance, MCP/default plugins) to per-operation invocation/session handles
  and explicit composite state keys.
- [ ] Prove two users and two identical raw IDs in old namespace directories
  share one actor-neutral `primary` binding without leakage.

## R2b — request/background ingress migration

- [ ] Return short-lived issuers for request/background subjects; mint distinct
  single-use operation+target tokens for nested router/binding and every start/
  status/progress/result/cancel/stop/artifact/session/effect operation.
- [ ] Retire/narrow raw dispatcher exports; preflight managed/protected policy;
  enforce global-user/Workspace-epoch fences in auth/issuer and every membership/
  invite/create/promotion/lifecycle path, with retirement-job-only bypass.
- [ ] Register/heartbeat every process-local runtime owner; collect all live
  replica acks/stale-lease denial and cross-app offline jobs before provider/
  global-user finalization.
- [ ] Journal validated host-session/plugin-state cleanup for doomed Workspaces
  and departing actors; retry failures without touching collaborator data.
- [ ] Migrate Core, full-app managed MCP, Agent MCP delegate/share/artifacts,
  boring-automation hosted/manual/scheduled runs, and trusted-plugin context.
- [ ] Retain only stable IDs/receipts, never a raw authorized Workspace.
- [ ] Prove revocation after resolver creation and after task start across status,
  result/artifact, cancel/stop, and session reads.
- [ ] Core passes only authorized Workspace facts to Workspace and never composes
  agents; public APIs remain default-only.
- [ ] Preserve full-app omitted-policy session/history behavior.

## R3 — static multi-agent foundation

- [ ] Add global agent definitions and Workspace default/allowed policies only
  after R2a/R2b remove actor-scoped binding state.
- [ ] Validate/freeze the complete graph at startup.
- [ ] Keep trusted server/package plugin surfaces grouped by one canonical ID.
- [ ] Return plugin-namespaced provisioning/skill roots for agent filtering.
- [ ] Filter prompt/tools/skills/Pi resources per agent.
- [ ] Compute and provision the effective Workspace plugin union once.
- [ ] Keep committed/candidate snapshots coordinator-private; expose only
  tracked `withReadLease` and callback-scoped revocable staged access; use opaque
  participant tokens and test retention after commit/abort fails.
- [ ] Build generation-namespaced resources; stage asset/backend records and SSE
  events; abort all before commit or complete-forward while readers stay blocked.
- [ ] Gate every provisioned-resource consumer, including skills/catalog/
  diagnostics/capabilities, Pi loaders, plugin lists/SSE/runtime backends,
  bridges, and background jobs.
- [ ] Preserve compatibility asset/runtime-backend reload inside the generation
  transaction without changing explicit policy membership/routes.
- [ ] Add lazy `Map<agentTypeId, Promise<AgentBinding>>`; generation coordinator
  `unenroll` is idempotent/writer-serialized and discards staged tokens on every
  failed-load/retirement path before map removal.
- [ ] Ship the exact capabilities union: unchanged unversioned legacy primary or
  `{schemaVersion:2,catalogScope:"authorized-workspace-default"}` only; update
  explicit host/client in the same cohort and use authorized default `/catalog`.
- [ ] Keep standard tools, explicit Pi policy, and non-fatal collisions.
- [ ] Prove two distinct actor-neutral agents share exact Workspace/Sandbox.

## R4 — declarative source correction

- [ ] Keep identity, version, label, description, and instructions only.
- [ ] Require host agent type equals source `definitionId`.
- [ ] Preserve bounded, contained, import-free reads.
- [ ] Reject non-empty legacy capability/tool/skill/MCP refs.
- [ ] Remove unpublished authored catalog/tool runtime semantics per R0 audit.
- [ ] Simplify `agent validate` success output and tests.
- [ ] Prove no sibling executable import and frozen/redacted output.
- [ ] Run packed Agent/CLI consumer proof.

## R5 — regular `agent dev` and conformance

- [ ] Implement clean launcher from current `main`.
- [ ] Call `createWorkspaceAgentServer()` directly.
- [ ] Keep normal runtime/plugin/model/session options.
- [ ] Support one-shot and loopback serve as ingress/lifecycle differences only.
- [ ] Add exact cleanup, signal, listen-failure, and redaction tests.
- [ ] Prove one-shot/serve/regular-server behavior capture equality.
- [ ] Migrate plugin-cli's fake reload session ID and run exact-cohort
  Agent/Workspace/Core/CLI/plugin-cli package proof.
- [ ] Update package docs and rollback instructions.

## R6 — Seneca and closeout

- [ ] Replace Seneca #16 from current Seneca `main`.
- [ ] Use declarative sources plus trusted Seneca plugins.
- [ ] Configure two workspace types with default + allowed agent policies.
- [ ] Seed dedicated customer/company workspace once through trusted host script
  where needed.
- [ ] Pin and prove exact Boring package cohort.
- [ ] Wait for #391 Core domain/auth/create/frontend/typed-rollback track.
- [ ] Run two-domain auth/type/session/restart negatives.
- [ ] Execute typed-aware rollback and restore.
- [ ] Link replacement PRs before closing #816/#817/Seneca #16 as superseded.
- [ ] Run final architecture/security/spec review with no open P0/P1 finding.

## Deferred follow-up TODOs

- [ ] Design Boring Pi package/extension seam.
- [ ] Add WorkspaceRuntime backend for `pi-subagents`.
- [ ] Productize human agent selector/switch/fork.
- [ ] Decide workspace-type route gating.
- [ ] Audit fatal tool collision mode.

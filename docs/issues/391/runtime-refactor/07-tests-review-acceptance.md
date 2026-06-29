# 07 — Tests, review, acceptance

## Goal

Define proof required before implementation is accepted.

## Global test gates

### Runtime-free agent

- pure agent server starts with no workspace/sandbox/runtime bundle;
- no file/tree/search/git/fs-event routes;
- no file/bash/upload tools;
- no host cwd/path reaches harness construction, not just prompt;
- no cwd/workspace/AGENTS.md prompt leakage;
- pi audit encoded in snapshot tests or pure mode uses non-pi harness.

### Package layering

- `@hachej/boring-agent` has no value import from `@hachej/boring-bash`;
- provisioning normalizer/provider adapters live outside agent and are injected by host/core/CLI;
- `@hachej/boring-bash` can depend on agent types/tools only through approved boundaries;
- workspace/core compose both packages without cycles.

### Existing behavior compatibility

- direct/local/vercel modes still launch;
- workspace playground file tree/editor works;
- read/write/edit/find/grep/ls/bash work when boring-bash enabled;
- `execute_isolated_code` behavior preserved or consciously reassigned;
- upload/download behavior preserved;
- `exec_ui openFile` still opens file panes;
- `/api/v1/ui/*` and `/api/v1/plugins/:pluginId/*` still work.

### Split-brain prevention

For each provider:

- file route write visible to bash;
- bash-created file visible to file routes/search;
- git/status routes use same source of truth;
- readonly facade exposes no exec;
- partial view with exec physically excludes denied files.

### Named filesystem binding / projection conformance

For #416 and future boring-bash ownership, tests must also prove that one active runtime can carry explicit named filesystem bindings without collapsing identity into path strings:

- tools/routes/UI use `(filesystem, path)` identity; legacy path-only defaults to `user`;
- `user:/x` and `company_context:/x` are distinct resources even when paths match;
- path strings such as `/company_context/x` or `company_context:/x` do not switch filesystem identity;
- provider-declared projection/mount modes are represented in prepared binding lifecycle tests;
- readonly policy-filtered projections physically omit denied files/folders before exposure to shell/tools/UI;
- readonly full-store mounts fail conformance if denied files are present;
- denied names, snippets, sentinel contents, hidden counts, pagination side channels, and stale cached outputs do not leak through read/list/find/grep/search/shell/UI/transcript metadata;
- policy invalidation rebuilds or drops stale prepared bindings;
- readwrite management projections are distinct policy-granted bindings, not role-hardcoded upgrades of a normal readonly session.

This is an additive update to #391: PR1 for #416 may create only a tiny `@hachej/boring-bash` skeleton and type contracts. Existing file/bash tools/routes/providers stay on their current code paths until the later extraction plan moves them. `@hachej/boring-agent` receives injected tools/features; it does not become the long-term owner of company filesystem behavior.

### Provisioning/readiness

- requirement merge by id;
- conflict rejection;
- fingerprint skip preserved;
- real two-tier readiness remains compatible: aggregate `ReadyState` (`provisioning|ready|degraded`) plus per-capability `CapabilityState` (`not-started|preparing|ready|failed`);
- optional failure is represented without breaking existing enums and does not block unrelated tools;
- health check gates tools/panels;
- SDK artifacts do not leak host paths;
- remote-worker hardening handshake fail-closes;
- remote-worker client/provider/protocol/server split preserves package boundaries.

### Plugins/child apps

- import-free manifest validation;
- hosted plugin fail-closed before code execution;
- secret status exposed without raw value;
- managed service plugin lifecycle: start, health, port/iframe/proxy, teardown;
- child-app/workspace-kind policy narrows requirements;
- Macro requirements do not leak into generic workspace;
- full-app reload/plugin runtime resolves per workspace/agent.

### Multi-agent/session

- two agents in same workspace with same `sessionId` do not share binding/transcript/catalog;
- `agentId` included in binding scope key and `sessionNamespace`;
- session root uses host durable session root;
- per-agent readiness/tool catalogs;
- session search scoped by workspace+agent;
- deep links open target session safely;
- external hooks authenticate/redact/route;
- delegation depth cap and stale-write safeguards.

### UI/file/document

- file tree provider path-list/tree-index works;
- fs-event deltas update tree;
- document-authority write/edit override routes through active coordinator;
- file panes and surface resolver keep ids/behavior;
- missing panels/capabilities produce clear UI diagnostics.

## Issue coverage acceptance

Do not close unrelated backlog issues just because this abstraction lands.

Can close or materially advance:

- #391;
- #12 if harness pluggability acceptance is satisfied;
- #242 if route composition acceptance is satisfied;
- #16/#223 if provider capability abstraction and adapter composition land;
- #26/#220/#221 if file API/UI ownership lands;
- parts of #357/#254/#256 if plugin capability declaration lands;
- parts of #243/#211 if multi-agent session routing/search lands.

Must remain separate unless explicitly implemented:

- #376 child-app platform product/deployment/billing;
- #381/#197 product plugin specs;
- #377/#361/#363/#362 multi-project nav UI;
- #375/#358/#308 visual/theme/pane polish;
- #318 desktop wrapper;
- #267 performance;
- #127/#51/#27 billing/auth/database;
- #122 docs annotation UI;
- #95 dependency migration;
- #5 event bus typing.

## Thermo review protocol

Before implementation:

1. Review each plan file independently.
2. Review the pack as a whole for contradictions.
3. Patch accepted blockers.
4. Rerun blocker-only review.
5. Record review artifacts in `.tmp/boring-bash-plan-reviews/`.

Review prompt:

```txt
You are an extremely strict thermo architecture reviewer. Review only. Do not edit files.
For the target plan file, find blockers, contradictions with sibling files, missing tests, package-boundary risks, split-brain risks, and implementation traps.
Output: verdict, blockers, concrete edits, non-blocking concerns.
```

Approval bar:

- no greenfield duplication of existing seams;
- no import cycle;
- no vague provider capability claims;
- no unreviewed pure-agent cwd assumption;
- no session/agent/child-app scope leak;
- no missing split-brain test;
- no overclaim about open issues.

## Final acceptance

The plan pack is ready for beads/implementation when:

- all files pass blocker-only thermo review;
- issue #391 body points to the plan pack;
- open decisions are either resolved or explicitly deferred;
- every implementation phase has clear exit criteria;
- tests above are assigned to phases.

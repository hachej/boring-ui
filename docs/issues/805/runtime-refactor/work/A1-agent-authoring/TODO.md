# A1 executable TODO map

> [`PLAN.md`](PLAN.md) is authoritative. Beads control dispatch.

## A1.0 — Plan and graph

- [ ] Canonical Decision 26 recut merged.
- [ ] #805 marks A1 active while other work remains deferred.
- [ ] Old `wt-391-forward-d3y` superseded.
- [x] Epic `wt-391-forward-c0u` and A1 Beads `.1`–`.7` created.
- [x] #391 `o0b.25` retained as thin `o0b.17 + c0u.3` integration.
- [x] `o0b.18` remains blocked by `o0b.25`; exact release `o0b.20` depends on `c0u.7` before `o0b.21`.
- [ ] Bead lint/cycles/robot graph and Sol xhigh review clean.

## A1.1 — Materialized source

- [ ] `MaterializedAgentSourceV1` server export.
- [ ] Compile in memory and extract verified instructions.
- [ ] ID grammar and expected-ID match.
- [ ] Reject non-empty capability/skill/MCP refs as unsupported.
- [ ] Ref-free returns `tools: []`; tool refs fail catalog-required until A1.2.
- [ ] Freeze/copy output.
- [ ] Add frozen canonical errors and CLI error envelope.
- [ ] Server/shared/front export tests.

## A1.2 — Trusted tools and collision policy

- [ ] Per-agent tool allowlist.
- [ ] Strict tool name/description/schema/readiness/execute validation.
- [ ] Preserve declared order.
- [ ] Reject absent catalog, unknown ref, invalid tool, duplicate name.
- [ ] Add `mergeTools` collision policy; default remains last-wins.
- [ ] Authored/dev policy errors across standard/authored/plugin tools.
- [ ] Prove no dynamic import.

## A1.3 — Validate CLI

- [ ] `boring-ui agent validate <dir>`.
- [ ] Human output.
- [ ] Exact `AgentValidateSuccessV1` JSON.
- [ ] Exact `AgentCliErrorV1` JSON.
- [ ] Stable exits and redaction.
- [ ] Existing commands/help remain compatible.

## A1.4a — Embeddable dev seam

- [ ] Accept already materialized source/workspace/runtime/dispatcher; no catalog input.
- [ ] Existing composer/lifecycle only.
- [ ] Disable ambient plugins/skills by default.
- [ ] Collision policy error.
- [ ] Capture harness asserts prompt and invokes a test tool.
- [ ] One disposal.

## A1.4b — Dev CLI

- [ ] Exactly one of `agent dev --prompt` one-shot or `agent dev --serve`.
- [ ] Bare/both modes fail `AUTHORED_AGENT_DEV_USAGE_INVALID` before effects.
- [ ] Explicit local workspace.
- [ ] Sandbox default; direct only via `--allow-direct`.
- [ ] Ref-free and pre-materialized trusted-tool cases; no second catalog resolution.
- [ ] Redacted identity output and exact exit/disposal.

## A1.5 — Conformance/docs

- [ ] Example validates/materializes/runs.
- [ ] Agent and CLI build/typecheck/tests.
- [ ] Packed-tarball consumer imports.
- [ ] Installed-bin validate/dev smoke.
- [ ] Server-only export positive/shared-front negatives.
- [ ] No authored executable loading.
- [ ] Relevant full-app compatibility.
- [ ] Boring/Seneca docs and rollback aligned.

## Explicitly removed

- [x] D1/AgentHost dependency.
- [x] Deployable-bundle runtime authority.
- [x] AgentDeployment and deployment/default resolver.
- [x] Definition/deployment/composition/resolved identity reporting.
- [x] D1-R0/M1 migration.
- [x] Dedicated deployment materialization.
- [x] Skill/MCP/capability name-only “resolution.”

# A1 executable TODO map

> [`PLAN.md`](PLAN.md) is authoritative. Beads control dispatch.
>
> Status note (2026-07-18): A1.0, A1.1, and A1.3 are completed and merged.
> A1.2, A1.4a, A1.4b, and A1.5 are implemented and Sol-clean on the complete
> stacked A1 branch, but remain stacked for review and explicitly unmerged. This
> TODO records implementation/proof state only; it does not claim release,
> production runtime integration, or #391/Seneca runtime binding.

## A1.0 — Plan and graph — completed/merged

- [x] Canonical Decision 26 recut merged.
- [x] #805 marks A1 active while other work remains deferred.
- [x] Old `wt-391-forward-d3y` superseded.
- [x] Epic `wt-391-forward-c0u` and A1 Beads `.1`–`.7` created.
- [x] #391 `o0b.25` retained as thin `o0b.17 + c0u.3` integration.
- [x] `o0b.18` remains blocked by `o0b.25`; exact release `o0b.20` depends on `c0u.7` before `o0b.21`.
- [x] Bead lint/cycles/robot graph and Sol xhigh review clean.

## A1.1 — Materialized source — completed/merged

- [x] `MaterializedAgentSourceV1` server export.
- [x] Compile in memory and extract verified instructions.
- [x] ID grammar and expected-ID match.
- [x] Reject non-empty capability/skill/MCP refs as unsupported.
- [x] Ref-free returns `tools: []`; tool refs fail catalog-required until A1.2.
- [x] Freeze/copy output.
- [x] Add frozen canonical errors and CLI error envelope.
- [x] Server/shared/front export tests.

## A1.2 — Trusted tools and collision policy — implemented/Sol-clean, stacked/unmerged

- [x] Per-agent tool allowlist.
- [x] Strict tool name/description/schema/readiness/execute validation.
- [x] Preserve declared order.
- [x] Reject absent catalog, unknown ref, invalid tool, duplicate name.
- [x] Add `mergeTools` collision policy; default remains last-wins.
- [x] Authored/dev policy errors across standard/authored/plugin tools.
- [x] Prove no dynamic import.

## A1.3 — Validate CLI — completed/merged

- [x] `boring-ui agent validate <dir>`.
- [x] Human output.
- [x] Exact `AgentValidateSuccessV1` JSON.
- [x] Exact `AgentCliErrorV1` JSON.
- [x] Stable exits and redaction.
- [x] Existing commands/help remain compatible.

## A1.4a — Embeddable dev seam — implemented/Sol-clean, stacked/unmerged

- [x] Accept already materialized source/workspace/runtime/dispatcher; no catalog input.
- [x] Existing composer/lifecycle only.
- [x] Disable ambient plugins/skills by default.
- [x] Collision policy error.
- [x] Capture harness asserts prompt and invokes a test tool.
- [x] One disposal.

## A1.4b — Dev CLI — implemented/Sol-clean, stacked/unmerged

- [x] Exactly one of `agent dev --prompt` one-shot or `agent dev --serve`.
- [x] Bare/both modes fail `AUTHORED_AGENT_DEV_USAGE_INVALID` before effects.
- [x] Explicit local workspace.
- [x] Sandbox default; direct only via `--allow-direct`.
- [x] Ref-free and pre-materialized trusted-tool cases; no second catalog resolution.
- [x] Redacted identity output and exact exit/disposal.

## A1.5 — Conformance/docs — implemented/Sol-clean, stacked/unmerged

- [x] Example validates/materializes/runs.
- [x] Agent and CLI build/typecheck/tests.
- [x] Packed-tarball consumer imports.
- [x] Installed-bin validate/dev smoke.
- [x] Server-only export positive/shared-front negatives.
- [x] No authored executable loading.
- [x] Relevant full-app compatibility.
- [x] Boring/Seneca docs and rollback aligned.

## Explicitly removed

- [x] D1/AgentHost dependency.
- [x] Deployable-bundle runtime authority.
- [x] AgentDeployment and deployment/default resolver.
- [x] Definition/deployment/composition/resolved identity reporting.
- [x] D1-R0/M1 migration.
- [x] Dedicated deployment materialization.
- [x] Skill/MCP/capability name-only “resolution.”

# A1 agent-authoring handoff

> [`PLAN.md`](PLAN.md) is canonical. Decision 26 supersedes all prior D1,
> deployment, digest-provenance, and workspace-default instructions.

## Product exit

```text
authored JSON + Markdown
-> import-free compiler
-> frozen materialized authored source
-> trusted per-agent tool allowlist
-> CLI validate
-> sandbox-default workspace-backed CLI dev turn
```

## Preconditions

- [ ] A1 plan-reset PR merged and A1.0 closed.
- [ ] No active writer owns overlapping Agent/CLI files.
- [ ] A1.1 may start independently; #391 `o0b.17` is required only for later thin integration `o0b.25`.

## Required invariants

- [ ] Existing compiler stays import-free/path-contained.
- [ ] `instructions.md` is the only authored prompt asset.
- [ ] `definitionId` is agent type ID; compatibility agent is `primary`, not `default`.
- [ ] Materialized source is server-only and frozen.
- [ ] Tool refs resolve from a trusted per-agent allowlist.
- [ ] Capability/skill/MCP refs reject as unsupported during runtime materialization.
- [ ] Generic A1 never imports `agents/**/tools/*.ts`.
- [ ] Digests are not runtime/deployment/session authority.
- [ ] No AgentDeployment, AgentHost, CAS, registry, or second composer.
- [ ] Workspace membership/runtime policy remains outside A1.

## Slice checklist

### A1.1 materialized source

- [ ] Server-only DTO/API.
- [ ] Verified instructions and ID/expected-ID checks.
- [ ] Unsupported reference-family failure.
- [ ] Ref-free returns no tools; non-empty tool refs fail catalog-required until A1.2.
- [ ] Eight frozen materializer codes and CLI error envelope; `AUTHORED_AGENT_CATALOG_INVALID` is a safe trusted-host catalog fault (500/report-bug).
- [ ] No runtime/workspace/session side effects.

### A1.2 tools and collision policy

- [ ] Per-agent allowlist resolution.
- [ ] Strict authored-tool validator.
- [ ] `mergeTools` compatibility default remains last-wins.
- [ ] Authored/dev collision policy is error across standard/authored/plugin tools.
- [ ] Missing/unknown/invalid/collision failures.
- [ ] No dynamic import.

### A1.3 validate CLI

- [ ] Human output.
- [ ] Exact versioned success/error JSON envelopes.
- [ ] Stable process exit/errors.
- [ ] No prompt/path/secret/deployment leakage.

### A1.4a embeddable dev seam

- [ ] Existing Workspace/Agent composer only.
- [ ] Materialized instructions/tools mapped once.
- [ ] Ambient plugins/skills disabled by default.
- [ ] Purpose-built capture harness proves prompt and tool invocation.
- [ ] Exact lifecycle/disposal.

### A1.4b dev CLI

- [ ] Exactly one of `--prompt` one-shot or `--serve`; bare/both fail stable usage code.
- [ ] Explicit local workspace.
- [ ] `local-sandbox` default.
- [ ] Direct mode only with `--allow-direct`.
- [ ] Trusted catalog adapter and ref-free support.
- [ ] Redacted workspace/agent/runtime/session output.

### A1.5 conformance/docs

- [ ] Example directory validates/materializes/runs.
- [ ] Packed Agent/CLI consumer and installed-bin smoke.
- [ ] Server-only import positive; shared/front negatives.
- [ ] No authored executable import.
- [ ] Boring/Seneca docs agree.
- [ ] Full proof/reviews/rollback recorded.

## Per-slice orchestration loop

1. Isolated `.worktrees/<a1-bead>/` branch.
2. Dispatch GPT-5.5 worker with the self-contained Bead.
3. Run focused proof.
4. Fresh Sol-high Standards + Spec/security review.
5. Return accepted findings to the same worker.
6. Repeat proof/review until CLEAN/APPROVE.
7. Commit, push, PR, exact proof.
8. Merge only after CI/review, close Bead, dispatch next ready node.

## Final proof

```bash
pnpm --filter @hachej/boring-agent build
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-ui-cli build
pnpm --filter @hachej/boring-ui-cli typecheck
pnpm --filter @hachej/boring-ui-cli test
pnpm lint:invariants
pnpm check:golden-path
git diff --check
```

Also record packed-tarball consumer imports, installed-bin validate/dev commands,
purpose-built prompt/tool capture, and relevant full-app compatibility tests.

# Runtime-free agents + `@hachej/boring-bash` plan pack

Status: first split pass, thermo-review loop required before implementation.

This folder replaces the original monolithic plan. The preserved source snapshot is [`legacy-monolith-source.md`](legacy-monolith-source.md).

## Plan files

1. [`00-global-isa.md`](00-global-isa.md) — global intent/strategy/architecture, framework lessons, destination, non-negotiables.
2. [`01-agent-core-runtime-free.md`](01-agent-core-runtime-free.md) — make `@hachej/boring-agent` truly fs-free by default.
3. [`02-boring-bash-environment.md`](02-boring-bash-environment.md) — `@hachej/boring-bash` package boundary, providers, file/bash/source-of-truth, tools/UI.
4. [`03-policy-provisioning-readiness.md`](03-policy-provisioning-readiness.md) — policy intersection, child-app/workspace-kind scoping, provisioning, readiness, secrets, services.
5. [`04-plugin-child-app-runtime.md`](04-plugin-child-app-runtime.md) — plugin manifests, hosted plugin safety, child-app/Macro hosting, runtime RPC.
6. [`05-multi-agent-sessions-hooks.md`](05-multi-agent-sessions-hooks.md) — multiple agents per deployed app/workspace, session namespaces, search, external hooks.
7. [`06-migration-phases.md`](06-migration-phases.md) — dependency-ordered implementation phases.
8. [`07-tests-review-acceptance.md`](07-tests-review-acceptance.md) — required tests, issue coverage, review gates, acceptance criteria.

## Implementation rule

Do not implement from only one file. Every implementation bead/PR must cite:

- the global ISA;
- the relevant area subplan;
- the migration phase;
- the acceptance/test section.

## Review rule

Each file must pass a thermo architecture review before coding starts. A clean review means:

- no package import cycle;
- no duplicated provisioning/readiness system;
- no filesystem/bash split brain;
- no hidden cwd/filesystem leak in pure agent mode;
- no child-app or multi-agent scope leak;
- no claim that unrelated backlog issues are solved by this abstraction.

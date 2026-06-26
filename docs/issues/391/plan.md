# Boring Bash agent/runtime refactor

This plan is now split into a plan pack.

Canonical source: [`docs/plans/boring-bash-agent-runtime-refactor/README.md`](boring-bash-agent-runtime-refactor/README.md)

Preserved monolithic source snapshot: [`docs/plans/boring-bash-agent-runtime-refactor/legacy-monolith-source.md`](boring-bash-agent-runtime-refactor/legacy-monolith-source.md)

## Files

1. [`00-global-isa.md`](boring-bash-agent-runtime-refactor/00-global-isa.md) — global intent, lessons, destination.
2. [`01-agent-core-runtime-free.md`](boring-bash-agent-runtime-refactor/01-agent-core-runtime-free.md) — pure runtime-free agent core.
3. [`02-boring-bash-environment.md`](boring-bash-agent-runtime-refactor/02-boring-bash-environment.md) — boring-bash package, providers, file/bash/source-of-truth.
4. [`03-policy-provisioning-readiness.md`](boring-bash-agent-runtime-refactor/03-policy-provisioning-readiness.md) — policy, provisioning, readiness, secrets, services.
5. [`04-plugin-child-app-runtime.md`](boring-bash-agent-runtime-refactor/04-plugin-child-app-runtime.md) — plugins, hosted runtimes, child apps/Macro.
6. [`05-multi-agent-sessions-hooks.md`](boring-bash-agent-runtime-refactor/05-multi-agent-sessions-hooks.md) — multi-agent workspaces, sessions, hooks.
7. [`06-migration-phases.md`](boring-bash-agent-runtime-refactor/06-migration-phases.md) — dependency-ordered migration phases.
8. [`07-tests-review-acceptance.md`](boring-bash-agent-runtime-refactor/07-tests-review-acceptance.md) — tests, review gates, acceptance.

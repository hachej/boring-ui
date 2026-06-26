---
github: https://github.com/hachej/boring-ui/issues/254
issue: 254
state: active
phase: plan
track: owner
flag: local-cli-only
updated: 2026-06-26
---

# CLI/local runtime plugin plan

Canonical docs:

1. [context.md](./context.md) — decisions, current state, terminology, guardrails.
2. [implementation-plan.md](./implementation-plan.md) — compact overview.
3. [prs/](./prs/) — one markdown plan per PR.

## Scope

Local `boring-ui` CLI only. Remote sandbox/cloud external plugin install and hot reload are deferred.

## Canonical PR split

Use these three PR-sized plans:

| PR | Plan | Purpose |
| --- | --- | --- |
| 01 | [prs/01-foundation.md](./prs/01-foundation.md) | Source metadata, remove old reload route, and shared jiti helper. No backend execution. |
| 02 | [prs/02-server-runtime-mvp.md](./prs/02-server-runtime-mvp.md) | Hot runtime behavior for external `boring.server` entries: plain module contract, route capture, registry, gateway, reload diagnostics. No install or host health route. |
| 03 | [prs/03-cli-install-and-verification.md](./prs/03-cli-install-and-verification.md) | Pi package-source install/list/remove MVP, aligned with PR #166 plugin-local dependency installs. `update` and backend self-test are follow-ups. |

## Core decisions

- CLI/local uses Pi trust semantics:

  ```txt
  boring-ui-plugin install <source> = trusted local code, enabled by default
  ```

- Plugin authors use one manifest field: `boring.server`.
- Internal plugins are fixed/boot-time and use the existing `WorkspaceServerPlugin` path.
- External CLI/local plugins are hot-reloaded through the gateway.
- PR #166's plugin-local dependency model remains intact: `/reload` never installs missing packages.
- Boring plugin packages are Pi packages: Pi consumes `package.json#pi`, boring consumes `package.json#boring`, and packages with no `pi` resources are valid no-ops for Pi.
- Install/list/remove should use Pi package source settings/roots, not a separate `.pi/boring-plugin-sources.json` registry.
- `/api/v1/agent/reload` is the only reload endpoint; remove the older `/api/boring.reload` developer route in PR 01.
- Boring already has jiti fresh import for diagnostic `boring.server` reload; missing piece is source-aware gateway/registry commit:

  ```txt
  jiti import -> capture handlers -> atomic registry swap -> gateway dispatch
  ```

## Guardrails

- Do not dynamically register/unregister raw Fastify routes. Hot-reload backend behavior by pre-registering one stable gateway route and swapping plugin handler tables behind it.
- Do not put backend handler tables in `BoringPluginAssetManager`.
- Keep one canonical reload endpoint (`/api/v1/agent/reload`). Extract a reload helper only if backend reload integration would otherwise bloat `createWorkspaceAgentServer.ts`.
- Preserve explicit internal/external source metadata; do not infer activation from path strings or store drift-prone backend-allowed booleans.
- Do not expose raw workspace roots to runtime backend handlers.
- Use exact-match route dispatch in MVP.
- Keep host health under `/api/v1/agent-plugins/:pluginId/health`, not plugin gateway space.

## Reviews

- [reviews/nuclear-simplicity-robustness-pass2.md](./reviews/nuclear-simplicity-robustness-pass2.md)
- [reviews/latest-main-reassessment.md](./reviews/latest-main-reassessment.md)
- [reviews/pr166-reassessment.md](./reviews/pr166-reassessment.md)
- [reviews/reload-endpoint-removal-inventory.md](./reviews/reload-endpoint-removal-inventory.md)

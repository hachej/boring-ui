# Slice 1 proof

Implemented the opt-in composed-server prefix, including prefix-aware raw runtime backend dispatch and runtime-projection HTTP/upgrade parsing. Authenticated browser command delivery selects fetch polling when an Authorization header is present; the bearer credential remains in headers and never enters the URL. Hosted plugins can use `createWorkspaceUiCommands(ctx.bridge)` for instance-bound dispatch; ambient helpers remain deprecated single-server compatibility only.

Focused proof (2026-09-14):

- `pnpm --filter @hachej/boring-workspace exec vitest run src/shared/plugins/__tests__/uiBridgeRegistry.test.ts src/front/bridge/__tests__/uiCommandStream.test.ts src/server/runtimeBackend/__tests__/runtimeBackend.test.ts src/server/runtimeProjection/__tests__/runtimeProjectionRoutes.test.ts src/server/__tests__/createWorkspaceAgentServer.test.ts -t 'route prefix|authenticated fetch|runtimeBackendGateway|runtimeProjectionRoutes|workspace UI bridge registry'` — 13 passed.
- `git diff --check` — clean.
- Workspace package typecheck is environment-blocked by missing generated `@hachej/boring-agent` declaration outputs; targeted tests transpile and pass.

Review revision: removed eager `ready()` so CLI/host callers retain their late route-composition window; `pnpm run test:agenthost-compositions` passes all seven exact composition roots, including CLI folder mode. RuntimeProjectionBroker now validates and owns its mount base and generates prefix-aware bootstrap, location, and cookie Path values; projection-shaped unprefixed upgrades are rejected without consuming unrelated upgrades. `createWorkspaceAgentServer` no longer publishes any process-global UI bridge; hosted commands remain instance-bound through `ctx.bridge`, while ambient publication is explicit legacy-adapter API only.

Additional focused proof (2026-09-15):

- `pnpm --dir packages/workspace exec vitest run src/server/runtimeProjection/__tests__/runtimeProjectionBroker.test.ts src/server/runtimeProjection/__tests__/runtimeProjectionRoutes.test.ts` — 10 passed.
- `pnpm --dir packages/workspace exec vitest run src/app/server/__tests__/createWorkspaceAgentServer.test.ts -t 'preserves the caller composition window'` — 1 passed.
- `pnpm run test:agenthost-compositions` — all seven named roots passed.
- Workspace typecheck remains environment-blocked by absent generated `@hachej/boring-agent` declaration outputs. ESLint was attempted twice but the local linter process was OOM-terminated; CI must provide the authoritative lint result.

No slice-2 browser proof or later runtime/identity work is included.

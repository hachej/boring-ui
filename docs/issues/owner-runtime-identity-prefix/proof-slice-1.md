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

Real-listening composed-server proof (current slice-1 correction revision):

- `createWorkspaceAgentServer.listening.test.ts` starts two actual TCP listeners with distinct prefixes, tokens, runtime-backend registries, projection brokers, and UI bridges. It covers public prefixed health/readiness; missing/valid bearer auth; header-authenticated polling; runtimeBackend prefixed raw HTTP logical suffix plus unprefixed and plugin-root negatives; generated projection bootstrap/cookie/location plus HTTP suffix proxying; prefixed projection WebSocket success and bounded unprefixed rejection; an unrelated sibling WebSocket; cross-instance command isolation; and close-one/other-remains-live behavior.
- This proof intentionally does not invent a runtimeBackend WebSocket protocol: runtimeBackend coverage is raw HTTP; HTTP+WebSocket coverage belongs to runtimeProjection.
- Focused real-listener test: `pnpm --dir packages/workspace exec vitest run src/server/__tests__/createWorkspaceAgentServer.listening.test.ts` — 1 passed.
- Combined focused suite: 66 passed; one pre-existing/environmental fixture failed because `@hachej/boring-workspace/dist/server.js` has not been built in this worktree.
- Prefix validation is shared by the composed server and runtimeProjection broker through `server/routePrefix.ts`, removing the duplicate normalizers.

Abstraction review remains pending until review is rerun against the new head; this document does not claim merge readiness.
- After building `@hachej/boring-agent`, `pnpm --dir packages/workspace typecheck` passed.
- `pnpm --dir packages/workspace test` ran 2,327 tests: 2,313 passed, 11 skipped, and 3 failed (missing unbuilt Workspace dist fixture; existing late-route-init rejection behavior; unrelated async fleet UI timing). The new real-listener test passed in the package run.

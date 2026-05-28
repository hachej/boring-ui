# CLI Native Plugin Front Loading Checklist

## Scope lock

- [ ] Treat this as the **local CLI native frontend slice** of runtime-plugin v2 only
- [ ] Keep `/api/v1/agent-plugins` as the discovery source of truth
- [ ] Keep `/reload` as the only runtime plugin registry refresh boundary
- [ ] Do not add a separate one-time bootstrap registration path
- [ ] Do not broaden into hosted iframe / sandbox tools / RPC / stable artifacts
- [ ] Keep first load on the same SSE/runtime-plugin path as `/reload` (no special bootstrap GET/register flow)
- [ ] Touch `@hachej/boring-agent` only if needed for a minimal reload seam aligned with runtime-plugin v2

## Server/runtime asset serving

- [ ] Add a CLI-owned runtime plugin front asset host
- [ ] Back it with embedded Vite or equivalent Vite-backed transforms
- [ ] Use one shared transform host, not one Vite server per workspace
- [ ] Serve host-owned browser URLs, not raw `/@fs/<abs-path>` URLs
- [ ] Resolve files from the current loaded plugin record, not by ad-hoc rescans
- [ ] Validate workspace/plugin/path containment before serving transformed modules
- [ ] Normalize current native front entry shape in a way that can grow into future `front/native.tsx`
- [ ] Force runtime plugin fronts onto host singletons for React + documented workspace/plugin runtime modules
- [ ] Keep Vite/HMR from directly re-registering runtime plugins outside `/reload`

## Folder mode wiring

- [ ] Add a small seam so folder mode runtime plugins can emit CLI-owned `frontUrl` values
- [ ] Keep the shared scanner generic where possible
- [ ] Confirm folder mode still discovers global + workspace-local Pi plugin roots

## Workspaces mode wiring

- [ ] Make request-scoped plugin managers emit CLI-owned `frontUrl` values
- [ ] Add `/api/v1/agent-plugins/events` in workspaces mode
- [ ] Ensure workspaces-mode events replay current loaded state without mutating refresh on connect
- [ ] Add ensure-loaded / initialize-once path outside the SSE connect path
- [ ] Keep plugin events scoped to the active workspace id
- [ ] Wire workspaces-mode `POST /api/v1/agent/reload` into plugin-manager reload
- [ ] Preserve existing `/api/v1/agent/reload` response contract used by chat UI
- [ ] Confirm workspace switching changes the effective local plugin set

## Frontend wiring

- [ ] Enable runtime plugin loading in `packages/cli/src/front/App.tsx`
- [ ] Use `frontPluginHotReload="vite"` when native frontend loading is enabled
- [ ] Keep static `plugins` prop for boot-composed plugins only; runtime-discovered plugins should come through SSE
- [ ] Expose `runtimePluginFrontLoadingEnabled` + trust status through workspace meta
- [ ] Render local trust banner/status when native frontend loading is enabled

## CLI behavior

- [ ] Enable native runtime plugin frontend loading for the trusted-local CLI slice
- [ ] Expose explicit frontend-loading/trust state to the stock CLI UI
- [ ] Defer the exact `--no-plugin-dev` contract to the broader reload-v2/runtime-policy follow-up
- [ ] Treat this plan's deferral as authoritative for this slice even if older runtime-planning docs still have provisional flag wording

## Tests

### Unit
- [ ] Asset path containment / traversal rejection
- [ ] Deterministic host-owned `frontUrl` generation
- [ ] Native front-entry normalization behavior
- [ ] Singleton resolution / no second React copy behavior
- [ ] Frontend-loading/trust metadata behavior
- [ ] If agent seam added: reload hook contract behavior

### Integration
- [ ] Folder mode plugin list uses host-owned `frontUrl`
- [ ] Workspaces mode plugin list uses host-owned `frontUrl`
- [ ] Workspaces mode `/api/v1/agent-plugins/events` replays current plugins
- [ ] Workspaces-mode SSE first connect works without prior GET
- [ ] Workspaces-mode SSE connect/reconnect does not trigger hidden plugin refresh outside `/reload`
- [ ] Workspaces-mode reload bumps revision and emits SSE updates
- [ ] Workspaces-mode reload preserves existing response contract
- [ ] Global plugin visible in both workspaces; local plugin stays workspace-scoped

### Browser/runtime behavior
- [ ] Built CLI renders discovered plugin UI on first page load
- [ ] `/reload` refreshes through the same SSE path
- [ ] Failed import keeps previous good version
- [ ] Trust banner/status renders when native frontend loading is enabled
- [ ] Runtime plugin panel uses host React/context singletons cleanly

## Verification commands

- [ ] `pnpm --filter @hachej/boring-ui-cli run test`
- [ ] `pnpm --filter @hachej/boring-ui-cli run typecheck`
- [ ] `pnpm --filter @hachej/boring-workspace run test src/server/__tests__/agentPlugins.test.ts src/app/server/__tests__/createWorkspaceAgentServer.test.ts`
- [ ] `pnpm --filter @hachej/boring-workspace run typecheck`
- [ ] `pnpm --filter @hachej/boring-ui-cli build`
- [ ] If agent seam added: `pnpm --filter @hachej/boring-agent run test`
- [ ] If agent seam added: `pnpm --filter @hachej/boring-agent run typecheck`

## Done means

- [ ] Packaged folder mode renders discovered native plugin UI on first load
- [ ] Packaged workspaces mode renders discovered native plugin UI on first load
- [ ] `/reload` remains the only runtime plugin refresh boundary
- [ ] No raw `/@fs/...tsx` packaged CLI browser imports remain for runtime plugins
- [ ] Follow-up stays aligned with `docs/runtime-plugin-v2-hot-reload-plan.md`
- [ ] Exact `--no-plugin-dev` CLI flag semantics remain deferred to the broader reload-v2/runtime-policy follow-up

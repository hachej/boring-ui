# CLI Plugin Discovery Roots Checklist

## Scope

- [x] Keep plugin roots Pi-shaped
- [x] Global root: `~/.pi/agent/extensions/*`
- [x] Workspace root: `<workspace>/.pi/extensions/*`
- [x] Keep `~/.boring-ui/workspaces.yaml` for CLI workspace registry
- [x] Keep `.boring-agent/` runtime-owned
- [ ] Front-plugin first-load rendering in stock CLI (investigated: current CLI still mounts `plugins={[]}` and `frontPluginHotReload={false}`; follow-up if initial front plugin load is required)
- [x] No hot-reload redesign in this pass

## Implementation

### Shared discovery helpers
- [x] Add CLI helper for global/workspace plugin roots
- [x] Add CLI helper for plugin Pi snapshot
- [x] Add CLI helper for plugin asset manager creation

### Folder mode
- [x] Pass global Pi extension root into `createWorkspaceAgentServer()` plugin discovery

### Workspace package server
- [x] Add `additionalBoringPluginDirs` option to `createWorkspaceAgentServer()`
- [x] Merge additional dirs into boring plugin discovery roots

### Workspaces mode
- [x] Add request-scoped boring plugin discovery routes in CLI workspaces mode
- [x] Make workspaces mode `getPi()` include discovered plugin Pi resources

## Tests

### Unit
- [x] Root resolver tests
- [x] Pi snapshot helper tests

### Integration
- [x] `createWorkspaceAgentServer()` discovers plugin from added global root
- [x] Duplicate / malformed plugin behavior still tolerates healthy plugins (covered by existing workspace plugin scan tests)

### Docs / skill follow-up
- [x] Update boring plugin authoring skill to mention global Pi root discovery
- [x] Update boring system prompt to keep workspace-local scaffold path while mentioning `~/.pi/agent/extensions` for explicit global installs

### Manual/command verification
- [x] `pnpm exec vitest run packages/workspace/src/app/server/__tests__/createWorkspaceAgentServer.test.ts` (run from `packages/workspace`)
- [x] `pnpm exec vitest run packages/cli/src/__tests__/pluginDiscovery.test.ts packages/cli/src/__tests__/cli.integration.test.ts` (run from `packages/cli`)
- [x] `pnpm --filter @hachej/boring-workspace typecheck`
- [x] `pnpm --filter @hachej/boring-ui-cli build`
- [ ] `pnpm --filter @hachej/boring-ui-cli typecheck` (worktree-local node_modules symlink layout points CLI package imports at main-worktree workspace package declarations; direct build + tests passed, but full package typecheck is still worth rerunning in a fully installed worktree)

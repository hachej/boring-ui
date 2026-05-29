# Plugin System Roadmap (index)

## Status

Coherence layer over the plugin-system plans. This is **not** a new plan — it stitches the
existing ones into a single construction story, names the active epic, and surfaces the
unresolved seams so they get decided instead of re-litigated per plugin.

The individual plans are well-reviewed and authoritative; what was missing is a map. (Built
after the `niche-explorer` factory plugin repeatedly hit undocumented runtime limits — see
"Open decisions" #1.)

## The plans

| Plan | Owns | Status |
| --- | --- | --- |
| [runtime-plugin-trust-modes-plan](../runtime-plugin-trust-modes-plan.md) | shape & trust classes; effective-runtime matrix | ready for beads |
| [runtime-plugin-agent-generation-plan](../runtime-plugin-agent-generation-plan.md) | manifest-first generated plugins; author loop (steps 0–10) | canonical |
| [runtime-plugin-v2-hot-reload-plan](../runtime-plugin-v2-hot-reload-plan.md) | embedded/sandbox Vite, `/reload`, lifecycle/health | canonical |
| [plugin-agent-layer-end-to-end-fix-plan](../plugin-agent-layer-end-to-end-fix-plan.md) | agent authoring substrate, registry reactivity, evals | active/reactive |
| [plugin-front-factory-only-migration-plan](../plugin-front-factory-only-migration-plan.md) | `definePlugin()`-only; drop legacy `outputs[]` | narrow refactor |
| [workspace-bridge-rpc-plan](./workspace-bridge-rpc-plan.md) | route-free capability RPC; ask-user/Macro | **active epic — `boring-ui-v2-reorg-14a9` (P1)** |
| [runtime-plugin-local-dev-and-rpc-plan](./runtime-plugin-local-dev-and-rpc-plan.md) | CLI plugin DX: hot-reload + importable deps (Track B) + **route-free data access `data.v1.*`** (Track A) | proposal — Track A unblocked; Track B gated by decision #1 |

**Current focus:** the WorkspaceBridge RPC v1 epic (`boring-ui-v2-reorg-14a9`).

## Construction lifecycle → owner

| Stage | Owner plan(s) | State |
| --- | --- | --- |
| 1. Choose shape & trust (runtime vs app/internal) | trust-modes, agent-generation | ✓ |
| 2. Scaffold / file layout | agent-generation; CLI `scaffold-plugin` | ✓ |
| 3a. Author front (`definePlugin`, panels, leftTabs, surfaces, catalog) | front-factory-migration, agent-generation; authoring SKILL | ✓ |
| 3b. **Dependency model** (what a front may import) | local-dev-and-rpc *(proposal)* vs allowlist *(canonical)* | ✗ **conflict — decision #1** |
| 4. **Data access / display** (files/DBs) | runtime-plugin-local-dev-and-rpc § Principle 3 / Track A (`data.v1.*`, DuckDB) | ⏳ designed; **unblocked — ship first** (independent of decision #1) |
| 5. Server capability / RPC (no plugin routes) | workspace-bridge-rpc, hot-reload | ✓ |
| 6. Agent behavior (Pi extensions, tools, generated plugins) | agent-generation, hot-reload, trust-modes | ✓ |
| 7. Hot reload / iteration | hot-reload | ✓ |
| 8. Front-factory migration | front-factory-migration | ✓ narrow |
| 9. Verify / ship / deploy | agent-generation, end-to-end-fix; CLI `verify-plugin`; app-setup SKILL | ✓ |

Authoring conventions + the hard runtime limits live in
`packages/pi/skills/boring-plugin-authoring/SKILL.md` (import allowlist, no workspace React
hooks, leftTab needs a component, catalog pattern, prefer bundled data).

## Open decisions (the seams)

1. **Dependency model — allowlist vs workspace-built deps.** Canonical plans assume runtime
   fronts import only allowlisted singletons (React + `@hachej/boring-workspace*`);
   local-dev-and-rpc proposes declaring `dependencies` and bundling them in the isolated
   workspace (externalize only the singletons). `niche-explorer` empirically hit the allowlist
   wall (couldn't use `@hachej/boring-data-explorer`). **Decide:** strict allowlist forever, or
   workspace-built deps with externals contract. Everything in stage 3b waits on this.
2. **App/internal routes vs bridge.** Trust model entitles app/internal plugins to Fastify
   routes; workspace-bridge-rpc pushes Macro toward bridge ops; local-dev-and-rpc says "no
   routes for anyone." **Decide:** may app/internal keep routes, or is bridge the only path?
3. **Generic data access timing.** `data.v1.*` (DuckDB engine) is designed in
   runtime-plugin-local-dev-and-rpc § Principle 3 but not started. **Decide:** land Phase A before plugins need real querying, or let them keep
   bundling/`/raw` until then.
4. **Hosted build orchestration.** Local = embedded Vite; hosted = sandbox Vite — but no plan
   details the build worker, artifact cache, or HMR-proxy auth. **Owner: TBD.**
5. **Manifest versioning.** `boring.*`/`pi.*` keep gaining fields (handlers, deps, bridge ops);
   no deprecation/migration story. **Owner: TBD.**

## What you can build today (no open decision needed)

- **Runtime `.pi/extensions` plugin:** front-only or with Pi-extension agent tools; imports
  limited to React + `@hachej/boring-workspace*`; data via bundled `./data.ts` or
  `/api/v1/files/raw` (workspace-scoped header). Hot-reloads with `/reload`.
- **App/internal package plugin:** full deps, trusted server, DuckDB/data-catalog/data-explorer
  — bundled with the app; restart/redeploy to update. Use when you need real querying or libs
  today (the answer for a data-heavy plugin until decisions #1 and #3 land).

## Next actions

- Resolve decision #1 (dependency model) — it unblocks stage 3b and the local-dev-and-rpc plan.
- Ship `data.v1.*` Track A (local-dev plan Principle 3) — unblocked now via a host endpoint (no bridge dependency, independent of decision #1); the generic answer to stage 4. Migrate the transport to the bridge `call` lane later.
- Assign owners for #4 (hosted build) and #5 (manifest versioning).

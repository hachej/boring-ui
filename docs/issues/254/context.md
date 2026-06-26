# CLI/local runtime plugins — context

Status: canonical context for the CLI/local runtime plugin implementation plan.

Scope: local `boring-ui` CLI. Remote sandbox/cloud external plugin install and hot reload are deferred.

## One-line thesis

```txt
Internal plugins extend the app.
External CLI plugins extend the local workspace runtime.
```

CLI/local external plugins use the **Pi trust model**:

```txt
boring-ui-plugin install <source> = trusted local code, enabled by default
```

No permission prompts/grants in the CLI MVP. Hosted/cloud/marketplace can add permission policy later.

## Plugin classes

### Internal/app plugin

Trusted app-owned code shipped with the app.

Uses:

- app-owned domain APIs;
- first-party integrations;
- admin tools;
- DB/auth/service-backed behavior.

Allowed:

- native host React UI;
- `boring.server`;
- boot-time Fastify routes;
- host agent tools;
- app DB/auth/service access when app owner coded it.

Lifecycle:

```txt
server/routes/tools: boot-time only, restart/redeploy required
front/Pi in dev: may hot reload through existing asset paths
```

### External CLI/local plugin

User/agent/npm/git installed plugin active in a local CLI workspace.

Allowed:

- native frontend panels/commands/surface resolvers;
- plugin-local frontend deps installed in the plugin folder, with React/workspace/ui-kit kept host-provided;
- Pi extensions/skills/system prompts;
- runtime backend handlers through Boring gateway;
- npm/git/local package installs like Pi.

Not allowed:

- raw Fastify hot registration;
- app DB/auth internals by default;
- changing internal/app server routes without restart;
- remote sandbox assumptions.

### Remote sandbox/cloud external plugin

Deferred. Do not design this phase around remote install/hot reload.

## Current system summary

### Front runtime hot reload

Runtime fronts under plugin roots are scanned by `BoringPluginAssetManager`, announced over `/api/v1/agent-plugins/events`, imported by the browser with revision/cache-bust params, and atomically replace plugin-owned panels/commands/catalogs/surface resolvers.

Current hot-loaded fronts:

- preserve previous UI on import/register failure;
- do not dynamically mount providers/bindings;
- use CLI front runtime singletons to avoid dual React.

### Internal server plugins

Internal plugins are fixed/boot-time. Their `boring.server` entries resolve to:

```ts
defineServerPlugin({ routes, agentTools, systemPrompt, ... })
```

These are boot-composed. Route/tool changes require restart. The plugin-facing manifest field stays `boring.server`; source classification decides behavior: internal plugins are fixed/boot-time, external plugins are hot-reloaded through the gateway.

### Existing jiti behavior

Already implemented:

- `pluginEntryResolver.ts` uses `createJiti(import.meta.url, { moduleCache: false })` for dir-source `boring.server` entries with `hotReload: true`.
- `rebuildServerPlugins.ts` re-resolves those entries on `/reload`.

Important limitation:

```txt
current: jiti import -> validate -> diagnostics only
needed:  jiti import -> capture handlers -> atomic registry swap -> gateway dispatch
```

## Related PR delta

### PR #166 — Plugin-local deps and ui-kit scaffolds

Adds/establishes:

- runtime plugin fronts resolve non-host bare imports from the plugin's own `node_modules`;
- `react`, `react-dom`, `@hachej/boring-workspace*`, and `@hachej/boring-ui-kit` are host-provided/singleton imports;
- plugin authors install extra frontend deps inside `.pi/extensions/<plugin>/`, not workspace root;
- `/reload` never installs missing packages;
- `boring-ui-plugin verify` reports missing plugin-local deps and forbidden host-provided deps;
- scaffolded runtime plugins use `@hachej/boring-ui-kit` by default.

Impact on this plan:

- keep Pi-style plugin-local dependency behavior;
- do not make `boring-ui-plugin install` / `boring-ui plugin install` a hidden dependency installer for existing `.pi/extensions` authoring;
- avoid requiring runtime backend modules to import a host package just to be loadable.

### PR #157 — File records data access

Adds `GET /api/v1/files/records` and `readFileRecords()` so plugin UIs can read bounded JSON/NDJSON/CSV record pages without bundling data into front code.

### PR #158 — WorkspaceLink

Adds `WorkspaceLink`, `workspaceLinkCommand()`, and `workspaceLinkHref()` so plugin UIs can open files/surfaces/panels through the existing UI command bus instead of custom routes.

### PR #159 — Runtime plugin self-test

Adds `boring-ui test-plugin <name>` with Playwright reload/render diagnostics. This should become post-install/post-reload smoke testing for runtime plugins.

## Key implementation guardrails

- Do not dynamically register/unregister raw Fastify routes. Hot-reload backend behavior by pre-registering one stable gateway route and swapping plugin handler tables behind it.
- Keep one plugin-facing server field: `boring.server`. Internal plugins are fixed/boot-time; external CLI/local plugins are hot-reloaded through the gateway.
- Do not grow `createWorkspaceAgentServer.ts` with new reload logic; extract a focused reload helper only when it deletes complexity instead of adding abstraction.
- Do not put executable backend handler tables in `BoringPluginAssetManager`.
- Do not infer trust from path strings and do not store drift-prone `runtimeBackendAllowed` booleans; preserve explicit internal/external source metadata from the package source collector.
- Do not expose `workspace.root` or raw host paths to runtime backend handlers.
- Use exact-match backend route dispatch in MVP. No custom mini-router.
- Keep host health metadata outside plugin-owned gateway paths.
- Workspace-local plugin wins over global plugin with same id.

## Namespaces

Plugin-owned backend gateway:

```txt
/api/v1/plugins/:pluginId/*
```

Host plugin metadata/health:

```txt
/api/v1/agent-plugins
/api/v1/agent-plugins/:pluginId/health
```

## Install model

Target model mirrors Pi package sources. Implementation can ship install/list/remove first and add update later. This is package-source installation: npm/git installs should leave declared dependencies present inside the installed/cloned plugin package dir, while local-path installs reference the local package without auto-installing deps. Never install deps in workspace/app root. That is separate from `/reload` or verify fixing dependencies for already-authored plugins.

Boring plugin packages use normal package metadata:

```txt
package.json#boring  -> boring UI/runtime-server surfaces
package.json#pi      -> Pi resources, if any
```

A package with `boring` but no `pi` resources is valid: Pi resource loading no-ops, and boring still scans the package root. Do not add a second boring-owned package source registry such as `.pi/boring-plugin-sources.json`.

Implementation ownership:

```bash
boring-ui-plugin install npm:@boring-plugins/email-client
boring-ui-plugin install git:github.com/user/email-client@v1
boring-ui-plugin install https://github.com/user/email-client
boring-ui-plugin install ./plugins/email-client
boring-ui-plugin install -l ./plugins/email-client   # workspace-local

boring-ui-plugin remove <source-or-id>
boring-ui-plugin list

boring-ui plugin install ./plugins/email-client      # optional top-level facade/reuse
```

Scopes:

```txt
Global/user default:
  ~/.pi/agent/npm
  ~/.pi/agent/git
  ~/.pi/agent/extensions

Workspace-local with -l/--local:
  <workspace>/.pi/npm
  <workspace>/.pi/git
  <workspace>/.pi/extensions
```

Install output must clearly state whether plugin is global or workspace-local.

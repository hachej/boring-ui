# 00 — Vision and plugin taxonomy

## Thesis

Boring uses plugin APIs as a composition primitive, but not all plugin code has the same trust or lifecycle.

```txt
Internal plugins extend the app.
External plugins extend the workspace runtime.
```

## Internal/app plugins

Internal plugins are app-owned, trusted modules shipped with the app.

Examples:

- first-party app plugins;
- app-owned data/catalog plugins;
- admin/domain integrations;
- Macro-style domain APIs.

Allowed:

- native host React UI;
- `boring.server`;
- boot-time Fastify routes;
- host agent tools;
- app DB/auth/service access when app owner coded it.

Lifecycle:

```txt
server/routes/tools: boot-time only, restart/redeploy required
front/Pi in dev: may hot reload through current asset paths
```

## External CLI/local plugins

External plugins are installed or generated after the CLI workspace exists.

Examples:

- `.pi/extensions/csv-viewer`;
- npm/git Boring plugin package installed as a Pi package source with `boring-ui-plugin install`;
- agent-authored local plugin.

CLI/local trust model mirrors Pi:

```txt
boring-ui-plugin install <source> = trusted local code, enabled by default
```

Allowed in CLI/local MVP:

- native frontend panels/commands/surface resolvers;
- Pi extensions/skills/system prompts;
- runtime backend handlers through a Boring-owned gateway;
- npm/git/local package installs like Pi.

Not allowed:

- raw Fastify hot registration;
- host app DB/auth internals by default;
- changing internal/app server routes without restart;
- remote sandbox/cloud assumptions.

## Remote sandbox/cloud external plugins

Deferred.

Do not design CLI/local implementation around remote hot reload. Remote external install likely needs host/control-plane mediation and sandbox restart/reprovision. That is a later plan.

## Backend distinction

```txt
boring.server
  internal/app trusted server plugin at boot, or external CLI/local runtime backend through the constrained runtime-server contract
  raw Fastify routes OK only for internal/app trusted server plugins
  external CLI/local handlers are loaded with shared jiti helper
  external CLI/local handlers are mounted through /api/v1/plugins/:pluginId/* gateway
  /reload swaps external handler registry
```

## CLI MVP product wording

When CLI starts:

```txt
Local plugin mode enabled: installed Boring plugins run as trusted local code.
Backend handlers are exposed only under /api/v1/plugins/:pluginId/*.
Use -l/--local on install to scope a plugin to one workspace.
```

When installing third-party source:

```txt
Security: Boring plugins run as trusted local code in CLI mode. Review third-party source before installing.
```

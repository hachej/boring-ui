# Merged PR #166 reassessment — plugin-local deps + ui-kit scaffold impact

PR #166 is now merged into `main`:

```txt
feat(cli): support plugin-local deps and ui-kit scaffolds (#166)
branch: plan/plugin-local-deps
merged into: origin/main
```

Merged PR #166 changes inspected:

- `docs/plans/runtime-plugin-local-dev-and-rpc/04-dependency-import.md`
- `docs/plans/runtime-plugin-local-dev-and-rpc/06-generated-plugin-design-system.md`
- `packages/cli/src/server/pluginFrontRuntime.ts`
- `packages/plugin-cli/src/server/verifyPlugin.ts`
- `packages/plugin-cli/templates/front-canonical.tsx`
- `packages/pi/skills/boring-plugin-authoring/SKILL.md`

## Verdict

The current CLI/local runtime backend plan remains valid, but merged main has a new simplification boundary.

The plan must not build another dependency/install system around `/reload`. Main now establishes the right local model:

```txt
plugin folder owns its deps
user/agent runs install in plugin folder
/reload never installs packages
verify reports missing deps clearly
host provides React/workspace/ui-kit singletons
```

## Impact 1 — Match Pi dependency behavior by source kind

Merged main teaches agents to do this for authored `.pi/extensions` plugins:

```bash
cd .pi/extensions/my-plugin
npm install recharts
boring-ui-plugin verify my-plugin <workspace-root>
```

That does **not** mean `boring-ui-plugin install <source>` should ignore dependencies. When the user explicitly asks to install a package/source, the installer should perform normal package-manager work for that source.

Correct boundary:

- `boring-ui-plugin install npm:<pkg>` installs the package and its declared dependencies in the plugin install/package root.
- `boring-ui-plugin install git:<repo>` clones and runs dependency install in the cloned plugin package directory when `package.json` exists, like Pi.
- `boring-ui-plugin install ./local-plugin` references the local path without copying and without auto-installing dependencies, matching Pi local-path behavior.
- For local paths, missing dependencies are surfaced as install hints, e.g. `cd ./local-plugin && npm install`.
- Dependency installs never run in the workspace root or app root.
- `/reload` never installs anything.
- `verify` reports missing deps and install hints; it does not mutate dependencies by itself.

Plan updated accordingly.

## Impact 2 — Runtime backend modules should not require workspace package imports

Merged main solves frontend host imports with a Vite runtime import policy. Runtime backend modules are loaded by server-side jiti, not the browser Vite runtime.

If PR 02 required every `.pi/extensions` backend module to write:

```ts
import { defineRuntimeServerPlugin } from "@hachej/boring-workspace/runtime-server"
```

then plain local plugins would need either:

1. package-local `@hachej/boring-workspace` dependency, which PR #166 discourages for host-provided packages; or
2. a new jiti/backend import alias system, which is unnecessary complexity.

Code-judo simplification:

```ts
export default {
  routes(router) {
    router.get("/messages", async () => ({ messages: [] }))
  },
}
```

Loader validates the plain object. Optional helper/types can exist for build-based package authors, but local runtime backend activation must not depend on importing them.

Plan updated accordingly.

## Impact 3 — PR #166 strengthens PR 02 verifier requirements

`boring-ui-plugin verify` currently warns that `boring.server` is boot-time/static and not activated by `/reload`.

After PR 02, verifier/docs need a source-aware explanation:

```txt
boring.server in app/internal sources       -> boot-time/static composition
boring.server in workspace/global CLI roots -> hot gateway backend
```

The plugin-facing field stays the same. Internal/external source classification decides activation behavior.

## Impact 4 — Host-provided modules list may need no backend equivalent

Frontend runtime has explicit host-provided imports:

```txt
react
react-dom
@hachej/boring-workspace*
@hachej/boring-ui-kit
```

Do not reflexively build the same host-provided import layer for backend jiti. For the MVP, plain object exports avoid that need.

If backend modules later need host SDK imports, add them deliberately as a follow-up with tests. Do not include that in server MVP.

## Impact 5 — PR 03 can be narrower than before

Because main already improves local plugin authoring DX, PR 03 should stay focused on source/package management:

```txt
install/list/remove plugin packages/sources
not dependency install during reload
not scaffold UI improvements
not frontend dep resolution
not backend self-test
```

This makes PR 03 smaller and avoids stepping on merged-main behavior.

## Required plan changes applied

- Context now calls out merged PR #166 decisions.
- PR 02 now uses `boring.server` plus a plain default-export runtime server module as canonical `.pi/extensions` shape.
- `@hachej/boring-workspace/runtime-server` is optional helper/types, not required for activation.
- PR 03 now says npm/git installs leave declared deps present, local-path installs do not auto-install deps, and reload never installs deps.
- Index/implementation overview now mention PR #166 dependency boundary.

## Final revised target

```txt
PR 01 — foundation
  source origin model
  internal/external source classification
  remove old reload route
  jiti helper

PR 02 — server runtime MVP
  one boring.server manifest field
  plain object backend module contract
  exact route capture
  registry/gateway/reload diagnostics
  verifier explains source-based boring.server activation

PR 03 — install/list/remove MVP
  source/package install manager
  global default + -l/--local
  npm/git install deps in installed/cloned plugin dirs
  local paths reference only and print dep install hints
  no dependency install during reload
  verify tells user what to install inside plugin folder
```

This aligns with current `main` and keeps the backend plan simple.

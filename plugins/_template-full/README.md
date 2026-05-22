# Full npm-package plugin template (`plugins/_template-full/`)

Reference shape for **app/internal publishable npm-package plugins**
under `plugins/*` — `tsup` builds to `dist/`, consuming apps install
the published package and declare it in `defaultPluginPackages`. The
existing plugins (`ask-user`, `data-explorer`, `data-catalog`) are
aligned to match this shape.

> **Building a generated/runtime user plugin instead** (hot-reloadable,
> no build step, drops into a workspace's `.pi/extensions/<name>/`)?
> Don't copy this template and don't use `npx` from inside the agent
> runtime — run the workspace-local `boring-ui scaffold-plugin <name>`.
> The CLI ships its own bundled templates; there's no copy-from source in
> the repo for the hot-reload form.

## Scaffolding a new plugin

```sh
cp -R plugins/_template-full plugins/<your-name>
cd plugins/<your-name>
# rename: `sample` → `<your-name>` in src/, package.json:name,
#         tsup entries, vitest aliases as needed
pnpm install
pnpm typecheck && pnpm test
```

The plugin is automatically picked up by `pnpm-workspace.yaml`'s
`plugins/*` glob.

## Shape

```
plugins/<name>/
  package.json         private: true, workspace:* deps, nested exports map
  tsconfig.json        paths aliases into packages/workspace/src for fast iteration
  tsup.config.ts       nested entries (front/index, server/index, shared/index)
  vitest.config.ts     jsdom + @vitejs/plugin-react + globals: true
                       setupFiles: ./src/test-setup.ts
  src/
    front/
      index.ts         definePlugin({ ... }) — entry, re-exports
      panels.tsx
      catalogs.ts
      surfaceResolver.ts
      bindings.tsx
      __tests__/xxxPlugin.test.ts
    server/
      index.ts         createXxxServerPlugin() — agent tools, system prompt
    shared/
      constants.ts     ids, surface kinds
      types.ts         param/option types
      index.ts         re-export
```

## What lives where

- **front/** — anything that runs in the browser shell: panels, command
  contributions, catalog configs, surface resolvers, bindings.
- **server/** — anything that runs in the agent backend: agent tools,
  system prompt fragments, server hooks.
- **shared/** — constants and types used by both sides. Keep it tiny.
- **`src/test-setup.ts`** — jest-dom matchers, ResizeObserver + Range
  polyfills, testing-library cleanup. Each plugin owns its own copy;
  keep them in sync with `plugins/_template-full/src/test-setup.ts` if the
  canonical setup changes. Do **not** `import
  "@testing-library/jest-dom/vitest"` instead — see the comment at the
  top of the file for the reason.

## What this template intentionally does NOT have

- A `testing/` entry. Add one only when other packages need stable
  fixtures from your plugin (see `plugins/data-explorer/src/testing/`).

## Invariants

`packages/workspace/scripts/check-plugin-invariants.mjs` lints this
template (and the live plugins) for the plugin contract. Keep it valid.

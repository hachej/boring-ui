# Plugin template

Reference shape for **app/internal publishable npm-package plugins**.
The CLI copies this directory when you run:

```sh
boring-ui plugin create <your-name> --path plugins
cd plugins/<your-name>
pnpm install
pnpm typecheck && pnpm test
```

Or copy it manually:

```sh
cp -R packages/cli/templates/plugin plugins/<your-name>
# rename: `sample` → `<your-name>` in src/, package.json:name,
#         tsup entries, vitest aliases as needed
```

> **Building a generated/runtime user plugin instead** (hot-reloadable,
> no build step, drops into a workspace's `.pi/extensions/<name>/`)?
> Don't copy this template and don't use `npx` from inside the agent
> runtime — run the workspace-local `boring-ui scaffold-plugin <name>`.

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
      index.ts         definePlugin({ ... }) entry and re-exports
      panels.tsx
      surfaceResolver.ts
      __tests__/xxxPlugin.test.ts
    server/
      index.ts         createXxxServerPlugin() and default server factory
    shared/
      constants.ts     ids, surface kinds
      types.ts         param/option types
      index.ts         re-export
```

## What lives where

- **front/** — anything that runs in the browser shell: panels, command
  contributions, surface resolvers, providers, bindings.
- **server/** — anything that runs in the agent backend: agent tools,
  system prompt fragments, server hooks.
- **shared/** — constants and types used by both sides. Keep it tiny.
- **`src/test-setup.ts`** — jest-dom matchers, ResizeObserver + Range
  polyfills, testing-library cleanup. Each plugin owns its own copy;
  keep them in sync with `packages/cli/templates/plugin/src/test-setup.ts`
  if the canonical setup changes.

## Invariants

`packages/workspace/scripts/check-plugin-invariants.mjs` lints this
template (and the live plugins) for the plugin contract. Keep it valid.

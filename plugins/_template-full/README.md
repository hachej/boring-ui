# Full npm-package plugin template (`plugins/_template-full/`)

Reference shape for **app/internal publishable npm-package plugins**
under `plugins/*` — `tsup` builds to `dist/`, consuming apps install
the published package and declare it in `defaultPluginPackages`.

This mirror exists for repo contributors who prefer copying from
`plugins/`. The bundled CLI template at `packages/cli/templates/plugin/`
is the source used by `boring-ui plugin create`.

> **Building a generated/runtime user plugin instead** (hot-reloadable,
> no build step, drops into a workspace's `.pi/extensions/<name>/`)?
> Don't copy this template and don't use `npx` from inside the agent
> runtime — run the workspace-local `boring-ui scaffold-plugin <name>`.

## Scaffolding a new plugin

```sh
cp -R plugins/_template-full plugins/<your-name>
cd plugins/<your-name>
# rename: `sample` → `<your-name>` in src/, package.json:name,
#         tsup entries, vitest aliases as needed
pnpm install
pnpm typecheck && pnpm test
```

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

## Invariants

`packages/workspace/scripts/check-plugin-invariants.mjs` lints this
template (and the live plugins) for the plugin contract. Keep it valid.

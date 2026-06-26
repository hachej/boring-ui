# PR 03 — Shared jiti import helper

## Goal

Extract the existing jiti fresh-import behavior into a canonical helper.

## Scope

Current jiti behavior exists in `pluginEntryResolver.ts`. Move it below `app/server` so both internal `boring.server` diagnostics and external runtime `boring.server` loader can use it.

## Proposed files

- `packages/workspace/src/server/pluginImports/importServerModule.ts` new
- `packages/workspace/src/app/server/pluginEntryResolver.ts`
- tests for import helper behavior

## Helper behavior

- `hotReload: true` uses `createJiti(import.meta.url, { moduleCache: false }).import(path)`.
- Fallback to native `import()` when jiti unavailable, preserving existing warning.
- `hotReload: false` uses native import.

## Non-goals

- No runtime backend API.
- No gateway.
- No install command.

## Tests

- `hotReload: true` sees edited TypeScript source.
- `hotReload: false` preserves native import behavior.
- Missing jiti fallback warning is unchanged.
- `pluginEntryResolver.ts` still handles existing dir-source `boring.server` entries.

## Acceptance

- There is exactly one jiti import helper for workspace server plugin code.

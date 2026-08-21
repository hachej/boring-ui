import { resolve } from 'node:path'

/**
 * Single source-alias entry for every `@hachej/boring-sandbox/<subpath>` import.
 *
 * Vite/vitest configs across the repo used to hand-maintain one alias per
 * provider subpath. They now spread this one entry instead; TypeScript gets the
 * equivalent mapping from the `boring-source` export condition declared in
 * `tsconfig.base.json` and `packages/boring-sandbox/package.json`.
 */
export const sandboxSourceAlias = {
  find: /^@hachej\/boring-sandbox\/(.+)$/,
  replacement: resolve(import.meta.dirname, '../packages/boring-sandbox/src/$1/index.ts'),
}

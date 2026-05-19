import path from 'node:path'

export type BoringViteAlias = {
  find: string | RegExp
  replacement: string
}

export interface CreateBoringAppViteAliasesOptions {
  /** Host app root (typically `__dirname` of vite.config). */
  appRoot: string
}

/**
 * Vite `resolve` config for a boring app:
 *
 *  1. React-family singleton aliases (`react`, `react-dom`,
 *     `react-dom/client`, `react/jsx-runtime`, `react/jsx-dev-runtime`)
 *     pinning every dependency to the host app's React copy. REQUIRED
 *     for hot-loaded plugin components that call hooks — without it,
 *     pnpm-hoisted React duplicates cause `Invalid hook call` errors.
 *
 *  2. `dedupe: ["react", "react-dom"]` for the same reason.
 *
 * Monorepo contributors who want HMR while editing `@hachej/boring-*`
 * source files should run `tsup --watch` (or `turbo dev`) in each
 * package they're editing. The consuming Vite server picks up dist
 * changes through normal node_modules resolution — no special config
 * needed here.
 *
 *     export default defineConfig({
 *       plugins: [react(), tailwindcss()],
 *       resolve: createBoringAppViteAliases({ appRoot: __dirname }),
 *     })
 */
export function createBoringAppViteAliases(
  opts: CreateBoringAppViteAliasesOptions,
): { alias: BoringViteAlias[]; dedupe: string[] } {
  const nodeModules = path.resolve(opts.appRoot, 'node_modules')
  return {
    alias: [
      { find: /^react$/, replacement: path.resolve(nodeModules, 'react') },
      { find: /^react-dom$/, replacement: path.resolve(nodeModules, 'react-dom') },
      { find: /^react-dom\/client$/, replacement: path.resolve(nodeModules, 'react-dom/client.js') },
      { find: /^react\/jsx-runtime$/, replacement: path.resolve(nodeModules, 'react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.resolve(nodeModules, 'react/jsx-dev-runtime.js') },
    ],
    dedupe: ['react', 'react-dom'],
  }
}

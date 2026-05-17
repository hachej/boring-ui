import path from 'node:path'

export type BoringViteAlias = {
  find: string | RegExp
  replacement: string
}

export interface CreateBoringAppViteAliasesOptions {
  /** Host app root (typically `__dirname` of vite.config). */
  appRoot: string
  /**
   * Monorepo repo root (typically `path.resolve(__dirname, '../..')`).
   * Optional. When passed AND `process.env.BORING_USE_LOCAL_PACKAGES=1`,
   * `@hachej/boring-*` imports resolve to source files in the monorepo
   * for HMR while editing those packages. Otherwise the npm-installed
   * dist is used (normal mode for downstream consumers).
   */
  monorepoRepoRoot?: string
}

/**
 * Vite `resolve` config for a boring app. Bundles together:
 *
 *  1. React-family singleton aliases (`react`, `react-dom`,
 *     `react-dom/client`, `react/jsx-runtime`, `react/jsx-dev-runtime`)
 *     pinning every dependency to the host app's React copy. REQUIRED
 *     for hot-loaded plugin components that call hooks — without it,
 *     pnpm-hoisted React duplicates cause `Invalid hook call` errors.
 *
 *  2. `dedupe: ["react", "react-dom"]` for the same reason.
 *
 *  3. Optional `@hachej/boring-*` source aliases when
 *     `monorepoRepoRoot` is passed AND `BORING_USE_LOCAL_PACKAGES=1`.
 *     Lets monorepo developers iterate on boring packages with HMR
 *     instead of rebuilding dist between every edit.
 *
 * Drop directly into a vite config:
 *
 *     export default defineConfig({
 *       plugins: [react(), tailwindcss()],
 *       resolve: createBoringAppViteAliases({ appRoot: __dirname }),
 *     })
 *
 * Monorepo dev (with source-mode opt-in):
 *
 *     resolve: createBoringAppViteAliases({
 *       appRoot: __dirname,
 *       monorepoRepoRoot: resolve(__dirname, '../..'),
 *     })
 *     // run with BORING_USE_LOCAL_PACKAGES=1
 */
export function createBoringAppViteAliases(
  opts: CreateBoringAppViteAliasesOptions,
): { alias: BoringViteAlias[]; dedupe: string[] } {
  const nodeModules = path.resolve(opts.appRoot, 'node_modules')
  const reactAliases: BoringViteAlias[] = [
    { find: /^react$/, replacement: path.resolve(nodeModules, 'react') },
    { find: /^react-dom$/, replacement: path.resolve(nodeModules, 'react-dom') },
    { find: /^react-dom\/client$/, replacement: path.resolve(nodeModules, 'react-dom/client.js') },
    { find: /^react\/jsx-runtime$/, replacement: path.resolve(nodeModules, 'react/jsx-runtime.js') },
    { find: /^react\/jsx-dev-runtime$/, replacement: path.resolve(nodeModules, 'react/jsx-dev-runtime.js') },
  ]
  const useLocalPackages =
    process.env.BORING_USE_LOCAL_PACKAGES === '1' && Boolean(opts.monorepoRepoRoot)
  const sourceAliases = useLocalPackages
    ? buildBoringPackageSourceAliases(opts.monorepoRepoRoot!)
    : []
  return {
    alias: [...reactAliases, ...sourceAliases],
    dedupe: ['react', 'react-dom'],
  }
}

/**
 * Internal: builds the `@hachej/boring-*` package → source-file aliases
 * for the monorepo. Only used when `BORING_USE_LOCAL_PACKAGES=1` and a
 * `monorepoRepoRoot` is provided.
 */
function buildBoringPackageSourceAliases(repoRoot: string): BoringViteAlias[] {
  const coreSrc = path.resolve(repoRoot, 'packages/core/src')
  const agentSrc = path.resolve(repoRoot, 'packages/agent/src')
  const workspaceSrc = path.resolve(repoRoot, 'packages/workspace/src')

  return [
    { find: '@hachej/boring-core/front/top-bar-slot', replacement: path.resolve(coreSrc, 'front/components/TopBarSlot.tsx') },
    { find: '@hachej/boring-core/app/front/styles.css', replacement: path.resolve(coreSrc, 'app/front/styles.css') },
    { find: /^@hachej\/boring-core\/app\/front$/, replacement: path.resolve(coreSrc, 'app/front/index.ts') },
    { find: /^@hachej\/boring-core\/front$/, replacement: path.resolve(coreSrc, 'front/index.ts') },
    { find: '@hachej/boring-core/theme.css', replacement: path.resolve(coreSrc, 'front/theme.css') },
    { find: '@hachej/boring-agent/front/styles.css', replacement: path.resolve(agentSrc, 'front/styles/globals.css') },
    { find: /^@hachej\/boring-agent\/front$/, replacement: path.resolve(agentSrc, 'front/index.ts') },
    { find: /^@hachej\/boring-agent$/, replacement: path.resolve(agentSrc, 'front/index.ts') },
    { find: '@hachej/boring-workspace/globals.css', replacement: path.resolve(workspaceSrc, 'globals.css') },
    { find: /^@hachej\/boring-workspace\/shared$/, replacement: path.resolve(workspaceSrc, 'shared/index.ts') },
    { find: /^@hachej\/boring-workspace\/app\/front$/, replacement: path.resolve(workspaceSrc, 'app/front/index.ts') },
    { find: /^@hachej\/boring-workspace\/app\/server$/, replacement: path.resolve(workspaceSrc, 'app/server/index.ts') },
    { find: /^@hachej\/boring-workspace\/server$/, replacement: path.resolve(workspaceSrc, 'server/index.ts') },
    { find: /^@hachej\/boring-workspace\/testing$/, replacement: path.resolve(workspaceSrc, 'front/testing/index.ts') },
    { find: /^@hachej\/boring-workspace$/, replacement: path.resolve(workspaceSrc, 'index.ts') },
    { find: '@/front/lib/', replacement: `${workspaceSrc}/front/lib/` },
    { find: '@/front/', replacement: `${agentSrc}/front/` },
    { find: '@/components/', replacement: `${workspaceSrc}/front/components/` },
    { find: '@/lib/', replacement: `${workspaceSrc}/front/lib/` },
  ]
}

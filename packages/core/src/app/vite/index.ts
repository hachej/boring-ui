import path from 'node:path'

export type BoringViteAlias = {
  find: string | RegExp
  replacement: string
}

export interface CreateBoringAppViteAliasesOptions {
  repoRoot: string
}

export interface CreateBoringReactViteAliasesOptions {
  /** Vite host app root containing the React dependency used by the shell. */
  appRoot: string
}

export const BORING_REACT_VITE_DEDUPE = ['react', 'react-dom'] as const

export function createBoringReactViteAliases({ appRoot }: CreateBoringReactViteAliasesOptions): BoringViteAlias[] {
  const nodeModules = path.resolve(appRoot, 'node_modules')
  return [
    { find: /^react$/, replacement: path.resolve(nodeModules, 'react') },
    { find: /^react-dom$/, replacement: path.resolve(nodeModules, 'react-dom') },
    { find: /^react-dom\/client$/, replacement: path.resolve(nodeModules, 'react-dom/client.js') },
    { find: /^react\/jsx-runtime$/, replacement: path.resolve(nodeModules, 'react/jsx-runtime.js') },
    { find: /^react\/jsx-dev-runtime$/, replacement: path.resolve(nodeModules, 'react/jsx-dev-runtime.js') },
  ]
}

export function createBoringAppViteAliases({
  repoRoot,
}: CreateBoringAppViteAliasesOptions): BoringViteAlias[] {
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
    { find: /^@hachej\/boring-workspace\/testing$/, replacement: path.resolve(workspaceSrc, 'front/testing/index.ts') },
    { find: /^@hachej\/boring-workspace$/, replacement: path.resolve(workspaceSrc, 'index.ts') },
    { find: '@/front/lib/', replacement: `${workspaceSrc}/front/lib/` },
    { find: '@/front/', replacement: `${agentSrc}/front/` },
    { find: '@/components/', replacement: `${workspaceSrc}/front/components/` },
    { find: '@/lib/', replacement: `${workspaceSrc}/front/lib/` },
  ]
}

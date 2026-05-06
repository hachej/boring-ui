import path from 'node:path'

export type BoringViteAlias = {
  find: string | RegExp
  replacement: string
}

export interface CreateBoringAppViteAliasesOptions {
  repoRoot: string
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
    { find: /^@boring\/core\/app\/front$/, replacement: path.resolve(coreSrc, 'app/front/index.ts') },
    { find: /^@boring\/core\/front$/, replacement: path.resolve(coreSrc, 'front/index.ts') },
    { find: '@hachej/boring-core/theme.css', replacement: path.resolve(coreSrc, 'front/theme.css') },
    { find: '@hachej/boring-agent/front/styles.css', replacement: path.resolve(agentSrc, 'front/styles/globals.css') },
    { find: /^@boring\/agent\/front$/, replacement: path.resolve(agentSrc, 'front/index.ts') },
    { find: /^@boring\/agent$/, replacement: path.resolve(agentSrc, 'front/index.ts') },
    { find: '@hachej/boring-workspace/globals.css', replacement: path.resolve(workspaceSrc, 'globals.css') },
    { find: /^@boring\/workspace\/shared$/, replacement: path.resolve(workspaceSrc, 'shared/index.ts') },
    { find: /^@boring\/workspace\/app\/front$/, replacement: path.resolve(workspaceSrc, 'app/front/index.ts') },
    { find: /^@boring\/workspace\/testing$/, replacement: path.resolve(workspaceSrc, 'front/testing/index.ts') },
    { find: /^@boring\/workspace$/, replacement: path.resolve(workspaceSrc, 'index.ts') },
    { find: '@/front/lib/', replacement: `${workspaceSrc}/front/lib/` },
    { find: '@/front/', replacement: `${agentSrc}/front/` },
    { find: '@/components/', replacement: `${workspaceSrc}/front/components/` },
    { find: '@/lib/', replacement: `${workspaceSrc}/front/lib/` },
  ]
}

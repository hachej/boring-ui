import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const coreSrc = resolve(__dirname, '../../packages/core/src')
const agentSrc = resolve(__dirname, '../../packages/agent/src')
const workspaceSrc = resolve(__dirname, '../../packages/workspace/src')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@boring/core/front/top-bar-slot', replacement: resolve(coreSrc, 'front/components/TopBarSlot.tsx') },
      { find: '@boring/core/app/front', replacement: resolve(coreSrc, 'app/front/index.ts') },
      { find: '@boring/core/front', replacement: resolve(coreSrc, 'front/index.ts') },
      { find: '@boring/core/theme.css', replacement: resolve(coreSrc, 'front/theme.css') },
      { find: '@boring/agent/front/styles.css', replacement: resolve(agentSrc, 'front/styles/globals.css') },
      { find: '@boring/agent/front', replacement: resolve(agentSrc, 'front/index.ts') },
      { find: /^@boring\/agent$/, replacement: resolve(agentSrc, 'front/index.ts') },
      { find: '@boring/workspace/ui-shadcn', replacement: resolve(workspaceSrc, 'front/components/ui/index.ts') },
      { find: '@boring/workspace/globals.css', replacement: resolve(workspaceSrc, 'globals.css') },
      { find: '@boring/workspace/shared', replacement: resolve(workspaceSrc, 'shared/index.ts') },
      { find: '@boring/workspace/app/front', replacement: resolve(workspaceSrc, 'app/front/index.ts') },
      { find: '@boring/workspace/testing', replacement: resolve(workspaceSrc, 'front/testing/index.ts') },
      { find: /^@boring\/workspace$/, replacement: resolve(workspaceSrc, 'index.ts') },
      { find: '@/front/lib/', replacement: `${workspaceSrc}/front/lib/` },
      { find: '@/front/', replacement: `${agentSrc}/front/` },
      { find: '@/components/', replacement: `${workspaceSrc}/front/components/` },
      { find: '@/lib/', replacement: `${workspaceSrc}/front/lib/` },
    ],
  },
  build: {
    outDir: 'dist/front',
    emptyOutDir: true,
  },
})

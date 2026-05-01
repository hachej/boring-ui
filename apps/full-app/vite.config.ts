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
    alias: {
      '@boring/core/front/top-bar-slot': resolve(coreSrc, 'front/components/TopBarSlot.tsx'),
      '@boring/core/app/front': resolve(coreSrc, 'app/front/index.ts'),
      '@boring/core/front': resolve(coreSrc, 'front/index.ts'),
      '@boring/core/theme.css': resolve(coreSrc, 'front/theme.css'),
      '@boring/agent/front/styles.css': resolve(agentSrc, 'front/styles/globals.css'),
      '@boring/agent/front': resolve(agentSrc, 'front/index.ts'),
      '@boring/agent': resolve(agentSrc, 'front/index.ts'),
      '@boring/workspace/ui-shadcn': resolve(workspaceSrc, 'front/components/ui/index.ts'),
      '@boring/workspace/globals.css': resolve(workspaceSrc, 'globals.css'),
      '@boring/workspace/shared': resolve(workspaceSrc, 'shared/index.ts'),
      '@boring/workspace/app/front': resolve(workspaceSrc, 'app/front/index.ts'),
      '@boring/workspace/testing': resolve(workspaceSrc, 'front/testing/index.ts'),
      '@boring/workspace': resolve(workspaceSrc, 'index.ts'),
      '@/front/lib/': `${workspaceSrc}/front/lib/`,
      '@/front/': `${agentSrc}/front/`,
      '@/components/': `${workspaceSrc}/front/components/`,
      '@/lib/': `${workspaceSrc}/front/lib/`,
    },
  },
  build: {
    outDir: 'dist/front',
    emptyOutDir: true,
  },
})

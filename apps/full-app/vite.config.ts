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
      '@boring/core/front': resolve(coreSrc, 'front/index.ts'),
      '@boring/core/theme.css': resolve(coreSrc, 'front/theme.css'),
      '@boring/agent/ui-shadcn/styles.css': resolve(agentSrc, 'front-shadcn/styles/globals.css'),
      '@boring/agent/ui-shadcn': resolve(agentSrc, 'front-shadcn/index.ts'),
      '@boring/workspace/ui-shadcn': resolve(workspaceSrc, 'components/ui/index.ts'),
      '@boring/workspace/globals.css': resolve(workspaceSrc, 'globals.css'),
      '@boring/workspace': resolve(workspaceSrc, 'index.ts'),
      '@/front-shadcn/': `${agentSrc}/front-shadcn/`,
      '@/components/': `${workspaceSrc}/components/`,
      '@/lib/': `${workspaceSrc}/lib/`,
    },
  },
  build: {
    outDir: 'dist/front',
    emptyOutDir: true,
  },
})

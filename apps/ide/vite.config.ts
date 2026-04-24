import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const agentSrc = resolve(__dirname, '../../packages/agent/src')
const workspaceSrc = resolve(__dirname, '../../packages/workspace/src')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@boring/agent/ui-shadcn/styles.css': resolve(agentSrc, 'front-shadcn/styles/globals.css'),
      '@boring/agent/ui-shadcn': resolve(agentSrc, 'front-shadcn/index.ts'),
      '@boring/agent': resolve(agentSrc, 'front/index.ts'),
      '@boring/workspace/globals.css': resolve(workspaceSrc, 'globals.css'),
      '@boring/workspace': resolve(workspaceSrc, 'index.ts'),
      '@/front-shadcn/': `${agentSrc}/front-shadcn/`,
      '@/lib/': `${workspaceSrc}/lib/`,
      '@/components/': `${workspaceSrc}/components/`,
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/ready': 'http://localhost:8000',
    },
  },
})

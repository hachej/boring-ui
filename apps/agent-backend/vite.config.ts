import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const agentSrc = resolve(__dirname, '../../packages/agent/src')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@boring/agent/ui-shadcn/styles.css': resolve(agentSrc, 'front-shadcn/styles/globals.css'),
      '@boring/agent/ui-shadcn': resolve(agentSrc, 'front-shadcn/index.ts'),
      '@boring/agent': resolve(agentSrc, 'front/index.ts'),
      '@/': `${agentSrc}/`,
      '@': agentSrc,
    },
  },
  server: {
    port: 5181,
    proxy: {
      '/api': 'http://localhost:8001',
      '/health': 'http://localhost:8001',
      '/ready': 'http://localhost:8001',
    },
  },
})

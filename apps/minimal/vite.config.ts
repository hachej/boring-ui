import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

import { createAgentApp } from '@boring/agent/server'
import { startCoreServer } from './src/server/main'

const AGENT_API_PORT = Number(process.env.AGENT_API_PORT) || 5241
const CORE_API_PORT = Number(process.env.CORE_PORT) || 5242

const coreSrc = resolve(__dirname, '../../packages/core/src')
const workspaceSrc = resolve(__dirname, '../../packages/workspace/src')
const defaultWorkspaceRoot = resolve(__dirname, './fixtures')

let agentBoot: Promise<void> | null = null
async function startAgentBackend() {
  if (agentBoot) return agentBoot

  agentBoot = (async () => {
    const app = await createAgentApp({
      workspaceRoot: process.env.BORING_AGENT_WORKSPACE_ROOT ?? defaultWorkspaceRoot,
      mode: 'local',
      logger: false,
    })
    await app.listen({ port: AGENT_API_PORT, host: '127.0.0.1' })
  })()

  return agentBoot
}

let coreBoot: Promise<void> | null = null
async function startCoreBackend() {
  if (coreBoot) return coreBoot
  coreBoot = (async () => {
    await startCoreServer(CORE_API_PORT)
  })()
  return coreBoot
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'minimal-agent-backend',
      async configureServer() {
        await startAgentBackend()
      },
    },
    {
      name: 'minimal-core-backend',
      async configureServer() {
        await startCoreBackend()
      },
    },
  ],
  resolve: {
    alias: {
      '@boring/core/front': resolve(coreSrc, 'front/index.ts'),
      '@boring/core/theme.css': resolve(coreSrc, 'front/theme.css'),
      '@boring/workspace/ui-shadcn': resolve(workspaceSrc, 'components/ui/index.ts'),
      '@boring/workspace/globals.css': resolve(workspaceSrc, 'globals.css'),
      '@boring/workspace': resolve(workspaceSrc, 'index.ts'),
      '@/components/': `${workspaceSrc}/components/`,
      '@/lib/': `${workspaceSrc}/lib/`,
    },
  },
  server: {
    port: 5240,
    host: true,
    proxy: {
      '/api/v1/tree': `http://127.0.0.1:${AGENT_API_PORT}`,
      '/api/v1/files': `http://127.0.0.1:${AGENT_API_PORT}`,
      '/api/v1/stat': `http://127.0.0.1:${AGENT_API_PORT}`,
      '/api/v1/dirs': `http://127.0.0.1:${AGENT_API_PORT}`,
      '/auth': `http://127.0.0.1:${CORE_API_PORT}`,
      '/health': `http://127.0.0.1:${CORE_API_PORT}`,
      '/api/v1/config': `http://127.0.0.1:${CORE_API_PORT}`,
      '/api/v1/me': `http://127.0.0.1:${CORE_API_PORT}`,
      '/api/v1/workspaces': `http://127.0.0.1:${CORE_API_PORT}`,
      '/api/v1/capabilities': `http://127.0.0.1:${CORE_API_PORT}`,
    },
  },
})

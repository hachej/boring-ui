import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'
import { createAgentApp } from './createAgentApp'
import { resolveWorkspaceRoot } from './config/workspaceRoot'

const DEFAULT_FRONTEND_PORT = 5180

export async function startDevServer(port = 0) {
  const app = await createAgentApp({
    workspaceRoot: resolveWorkspaceRoot(),
    sessionId: 'default',
    logger: true,
  })
  const address = await app.listen({ port, host: '0.0.0.0' })
  return { app, address }
}

async function startViteDevServer(apiPort: number) {
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const appRoot = path.resolve(thisDir, '..', '..', '..', '..', 'apps', 'agent-playground')
  const apiTarget = `http://127.0.0.1:${apiPort}`

  const vite = await createViteServer({
    root: appRoot,
    plugins: [react()],
    server: {
      port: DEFAULT_FRONTEND_PORT,
      host: true,
      strictPort: false,
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        '/ready': apiTarget,
      },
    },
  })
  await vite.listen()
  vite.printUrls()
  return vite
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('/dev.ts') || process.argv[1].endsWith('/dev.js'))
) {
  const { app, address } = await startDevServer(0)
  const apiPort = Number(new URL(address).port)
  await startViteDevServer(apiPort)
  app.log.info(`@boring/agent API server listening at ${address}`)
}

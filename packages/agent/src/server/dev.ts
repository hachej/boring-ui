import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'
import { startStandaloneServer } from '../../app/server'
import { resolveWorkspaceRoot } from './config/workspaceRoot'

const DEFAULT_FRONTEND_PORT = 5180

export async function startDevServer(port = 0) {
  return startStandaloneServer({
    port,
    host: '0.0.0.0',
    workspaceRoot: resolveWorkspaceRoot(),
    sessionId: 'default',
    logger: true,
  })
}

async function startViteDevServer(apiPort: number) {
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const appRoot = path.resolve(thisDir, '..', '..', 'app')
  const apiTarget = `http://127.0.0.1:${apiPort}`

  const vite = await createViteServer({
    root: appRoot,
    plugins: [react()],
    server: {
      port: DEFAULT_FRONTEND_PORT,
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

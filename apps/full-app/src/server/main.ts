import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCoreWorkspaceAgentServer } from '@boring/core/app/server'

const DEFAULT_FRONTEND_PORT = 5173

async function startViteDevServer(
  appRoot: string,
  apiTarget: string,
  app: Awaited<ReturnType<typeof createCoreWorkspaceAgentServer>>,
): Promise<void> {
  const { createServer: createViteServer } = await import('vite')

  const vite = await createViteServer({
    root: appRoot,
    server: {
      port: DEFAULT_FRONTEND_PORT,
      strictPort: false,
      host: true,
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        '/auth': {
          target: apiTarget,
          changeOrigin: true,
          bypass(req) {
            const accept = req.headers.accept ?? ''
            if (req.method === 'GET' && accept.includes('text/html')) {
              return req.url
            }
            return undefined
          },
        },
      },
    },
  })

  await vite.listen()
  vite.printUrls()

  app.log.info(
    {
      event: 'full-app.vite.ready',
      frontendPort: DEFAULT_FRONTEND_PORT,
      apiTarget,
    },
    'full-app.vite.ready',
  )
}

async function main() {
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const appRoot = path.resolve(thisDir, '../..')
  const workspaceRoot =
    process.env.FULL_APP_WORKSPACE_ROOT ??
    path.resolve(tmpdir(), 'boring-ui-v2-full-app-workspace')
  await mkdir(workspaceRoot, { recursive: true })

  const production = process.env.NODE_ENV !== 'development'
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    workspaceRoot,
    serveFrontend: production,
  })

  const address = await app.listen({
    host: app.config.host,
    port: app.config.port,
  })

  app.log.info(
    {
      event: 'full-app.server.ready',
      address,
    },
    'full-app.server.ready',
  )

  if (!production) {
    const apiPort = Number(new URL(address).port)
    const apiTarget = `http://127.0.0.1:${apiPort}`
    await startViteDevServer(appRoot, apiTarget, app)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

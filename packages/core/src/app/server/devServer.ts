import type { CoreWorkspaceAgentServer } from './createCoreWorkspaceAgentServer.js'

const DEFAULT_FRONTEND_PORT = 5173

export interface StartCoreWorkspaceAgentDevServerOptions {
  appRoot: string
  buildServer: (options: { appRoot: string; serveFrontend: false }) => Promise<CoreWorkspaceAgentServer>
  frontendPort?: number
  eventPrefix?: string
}

export interface CoreWorkspaceAgentDevServerHandle {
  app: CoreWorkspaceAgentServer
  address: string
  apiTarget: string
}

export async function startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer,
  frontendPort = DEFAULT_FRONTEND_PORT,
  eventPrefix = 'core-workspace-agent',
}: StartCoreWorkspaceAgentDevServerOptions): Promise<CoreWorkspaceAgentDevServerHandle> {
  const app = await buildServer({ appRoot, serveFrontend: false })
  const address = await app.listen({
    host: app.config.host,
    port: app.config.port,
  })

  app.log.info({ event: `${eventPrefix}.server.ready`, address }, `${eventPrefix}.server.ready`)

  const apiPort = Number(new URL(address).port)
  const apiTarget = `http://127.0.0.1:${apiPort}`
  const viteModule = await (new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ createServer: (options: unknown) => Promise<{ listen: () => Promise<void>; printUrls: () => void }> }>)('vite')

  const vite = await viteModule.createServer({
    root: appRoot,
    server: {
      port: frontendPort,
      strictPort: false,
      host: true,
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        '/auth': {
          target: apiTarget,
          changeOrigin: true,
          bypass(req: { method?: string; headers: { accept?: string }; url?: string }) {
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
      event: `${eventPrefix}.vite.ready`,
      frontendPort,
      apiTarget,
    },
    `${eventPrefix}.vite.ready`,
  )

  return { app, address, apiTarget }
}

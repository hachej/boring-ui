import { buildServer, defaultAppRoot } from './index.js'

const DEFAULT_FRONTEND_PORT = 5173

async function startDevFrontend(
  appRoot: string,
  apiTarget: string,
  app: Awaited<ReturnType<typeof buildServer>>,
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
  const appRoot = defaultAppRoot()
  const app = await buildServer({ appRoot, serveFrontend: false })
  const address = await app.listen({
    host: app.config.host,
    port: app.config.port,
  })

  app.log.info({ event: 'full-app.server.ready', address }, 'full-app.server.ready')

  const apiPort = Number(new URL(address).port)
  const apiTarget = `http://127.0.0.1:${apiPort}`
  await startDevFrontend(appRoot, apiTarget, app)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

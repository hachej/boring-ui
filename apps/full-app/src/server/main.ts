import { buildServer } from './index.js'

async function main() {
  const app = await buildServer({ serveFrontend: true })
  const address = await app.listen({
    host: app.config.host,
    port: app.config.port,
  })

  app.log.info({ event: 'full-app.server.ready', address }, 'full-app.server.ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

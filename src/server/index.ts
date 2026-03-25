/**
 * Server entry point.
 *
 * Usage:
 *   npm run server:dev     # tsx watch (development)
 *   npm run server:start   # node --import tsx (production-like)
 */
import { createApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = createApp({ config, logger: true })

app.listen({ port: config.port, host: config.host }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info(`Server listening at ${address}`)
})

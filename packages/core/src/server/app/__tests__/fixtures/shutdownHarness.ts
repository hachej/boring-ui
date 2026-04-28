import { setTimeout as delay } from 'node:timers/promises'
import { createCoreApp } from '../../createCoreApp.js'
import type { CoreConfig } from '../../../../shared/types.js'

const mode = process.argv[2] === 'slow' ? 'slow' : 'clean'

const TEST_CONFIG: CoreConfig = {
  appId: 'shutdown-harness',
  appName: 'Shutdown Harness',
  appLogo: null,
  port: 0,
  host: '127.0.0.1',
  staticDir: null,
  databaseUrl: null,
  stores: 'local',
  cors: {
    origins: ['http://localhost:3000'],
    credentials: true,
  },
  bodyLimit: 16 * 1024 * 1024,
  logLevel: 'info',
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: {
    secret: 's'.repeat(64),
    url: 'http://localhost:3000',
    sessionTtlSeconds: 3600,
    sessionCookieSecure: false,
  },
  features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
}

const app = await createCoreApp(TEST_CONFIG)

app.decorate('db', {
  async end() {
    console.log('db-closed')
  },
})

if (mode === 'slow') {
  app.get('/slow', async () => {
    console.log('inflight-started')
    await delay(40_000)
    return { ok: true }
  })
}

const address = await app.listen({ port: 0, host: '127.0.0.1' })
console.log(`ready:${address}`)

if (mode === 'slow') {
  void fetch(`${address}/slow`).catch(() => {})
}

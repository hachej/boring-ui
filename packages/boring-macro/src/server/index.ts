import Fastify from 'fastify'
import rawBody from 'fastify-raw-body'
import { registerAgentRoutes } from '@boring/agent/server'
import { createMacroTools, MACRO_SYSTEM_PROMPT } from './tools/macroTools'
import { registerMacroRoutes } from './routes/macro'
import { registerBillingRoutes } from './routes/billing'
import { registerWaitlistRoute } from './routes/waitlist'
import { loadMacroConfig } from './config'

export interface MacroAppOptions {
  port?: number
  host?: string
  workspaceRoot?: string
  logger?: boolean
}

export async function createMacroApp(opts: MacroAppOptions = {}) {
  const port = opts.port ?? (Number(process.env.PORT) || 8000)
  const host = opts.host ?? (process.env.HOST || '0.0.0.0')
  const workspaceRoot = opts.workspaceRoot ?? (process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd())

  const macroConfig = await loadMacroConfig()
  const macroTools = createMacroTools(macroConfig.clickhouse)

  const app = Fastify({ logger: opts.logger ?? true })

  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    runFirst: true,
  })

  app.get('/info', async () => ({
    name: 'MacroAnalyst',
    version: '0.2.0',
  }))

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    extraTools: macroTools,
    mode: 'local',
    version: '0.2.0',
  })

  await app.register(registerMacroRoutes)
  await app.register(registerBillingRoutes)
  await app.register(registerWaitlistRoute)

  return { app, port, host }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  createMacroApp().then(async ({ app, port, host }) => {
    await app.listen({ port, host })
    app.log.info(`MacroAnalyst v2 listening on ${host}:${port}`)
  }).catch((err) => {
    console.error('Failed to start MacroAnalyst:', err)
    process.exit(1)
  })
}

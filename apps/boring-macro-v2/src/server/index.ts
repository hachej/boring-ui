// boring.macro server entry — the consolidated app.
//
// Uses @boring/workspace/server's createWorkspaceAgentApp (Phase 0 made
// this entry buildable) so the agent automatically gets:
//   - exec_ui / get_ui_state tools
//   - /api/v1/ui/* routes (PUT state, POST commands, SSE drain)
//   - a single in-memory bridge wired through both
// — no inlining required. The macro-specific bits (catalog/series/deck
// REST routes, billing, waitlist, agent tools) layer on top.

import rawBody from 'fastify-raw-body'
import { createWorkspaceAgentApp } from '@boring/workspace/server'
import { createMacroTools } from './tools/macroTools'
import { makeMacroServerPlugin } from '../plugin/server'
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

export async function buildServer(opts: MacroAppOptions = {}) {
  const port = opts.port ?? (Number(process.env.PORT ?? process.env.API_PORT) || 5210)
  const host = opts.host ?? (process.env.HOST || '0.0.0.0')
  const workspaceRoot =
    opts.workspaceRoot ??
    (process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd())

  const macroConfig = await loadMacroConfig()
  const macroTools = createMacroTools(macroConfig.clickhouse)

  const app = await createWorkspaceAgentApp({
    workspaceRoot,
    mode: 'local',
    logger: opts.logger ?? true,
    plugins: [makeMacroServerPlugin(macroTools)],
  })

  // rawBody is needed by the Stripe webhook (signature verification reads
  // the unparsed bytes). Register it BEFORE the billing routes so the
  // webhook handler sees the raw body on its request.
  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    runFirst: true,
  })

  app.get('/info', async () => ({
    name: 'boring.macro',
    version: '0.2.0',
  }))

  await app.register(registerMacroRoutes)
  await app.register(registerBillingRoutes)
  await app.register(registerWaitlistRoute)

  return { app, port, host }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  buildServer()
    .then(async ({ app, port, host }) => {
      await app.listen({ port, host })
      app.log.info(`boring.macro listening on ${host}:${port}`)
    })
    .catch((err) => {
      console.error('Failed to start boring.macro:', err)
      process.exit(1)
    })
}

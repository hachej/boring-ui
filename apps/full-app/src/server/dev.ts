import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'
import { serverPlugins } from './plugins.js'
import { buildCreditsWiring } from './credits.js'
import {
  createFullAppBoringMcpAgentToolsForRequest,
  fullAppAgentSessionNamespace,
  registerFullAppBoringMcpRoutes,
} from './boringMcp.js'
import { registerFullAppMcpManagedAgentRoutes } from './mcpManagedAgent.js'

const appRoot = appRootFromImportMeta(import.meta.url, 2)

function pluginAuthoringEnabledFromEnv(): boolean {
  return process.env.BORING_PLUGIN_AUTHORING === '1'
}

const frontendPort = Number(process.env.FRONTEND_PORT) || undefined

const DEV_LOGIN_EMAIL = 'dev@example.test'
const DEV_LOGIN_PASSWORD = 'Dev-local-2026!!x9'

function devLoginEnabledFromEnv(): boolean {
  return process.env.ENABLE_DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production'
}

function extractSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie()
  }

  const value = headers.get('set-cookie')
  return value ? [value] : []
}

async function registerDevLoginRoute(app: Awaited<ReturnType<typeof createCoreWorkspaceAgentServer>>): Promise<void> {
  if (!devLoginEnabledFromEnv()) return

  async function authPost(pathname: string, body: Record<string, unknown>): Promise<Response> {
    return app.auth.handler(new Request(new URL(pathname, app.config.auth.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  app.get('/dev-login', async (_request, reply) => {
    const email = process.env.DEV_LOGIN_EMAIL?.trim() || DEV_LOGIN_EMAIL
    const password = process.env.DEV_LOGIN_PASSWORD?.trim() || DEV_LOGIN_PASSWORD
    const name = process.env.DEV_LOGIN_NAME?.trim() || 'Dev'

    let response = await authPost('/auth/sign-in/email', { email, password })
    if (!response.ok) {
      response = await authPost('/auth/sign-up/email', { email, password, name })
    }

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      reply.status(response.status)
      return reply.send({
        error: 'dev_login_failed',
        message: message || 'Dev login failed. If the user already exists with a different password, reset the local compose Postgres volume or set DEV_LOGIN_PASSWORD to match it.',
      })
    }

    const setCookies = extractSetCookies(response.headers)
    if (setCookies.length > 0) {
      reply.header('set-cookie', setCookies.length === 1 ? setCookies[0] : setCookies)
    }

    return reply.redirect('/')
  })
}

startCoreWorkspaceAgentDevServer({
  appRoot,
  ...(frontendPort ? { frontendPort } : {}),
  buildServer: async (options) => {
    const credits = buildCreditsWiring()
    let appRef: Awaited<ReturnType<typeof createCoreWorkspaceAgentServer>> | undefined
    const app = await createCoreWorkspaceAgentServer({
      ...options,
      plugins: serverPlugins,
      externalPlugins: false,
      installPluginAuthoring: pluginAuthoringEnabledFromEnv(),
      metering: credits.meteringSink,
      getSessionNamespace: ({ workspaceId, request }) => fullAppAgentSessionNamespace({ workspaceId, request }),
      getExtraTools: (ctx) => appRef ? createFullAppBoringMcpAgentToolsForRequest(appRef, ctx) : [],
    })
    appRef = app
    credits.attach(app)
    registerFullAppBoringMcpRoutes(app)
    registerFullAppMcpManagedAgentRoutes(app, { metering: credits.meteringSink })
    await registerDevLoginRoute(app)
    return app
  },
}).catch((error) => {
  console.error(error)
  process.exit(1)
})

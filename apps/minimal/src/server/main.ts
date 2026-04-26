import { randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

import {
  createCoreApp,
  loadConfig,
  registerRoutes,
  registerWorkspaceRoutes,
} from '@boring/core/server'
import { LocalUserStore, LocalWorkspaceStore } from '@boring/core/server/db'

const DEV_USER_ID = 'minimal-dev-user'
const DEV_USER_EMAIL = 'dev@minimal.local'
const DEV_USER_NAME = 'Minimal Dev'
const DEV_PASSWORD = 'dev'
const APP_ID = 'minimal'

const sessions = new Map<string, { userId: string; expiresAt: number }>()

function createSession(userId: string): string {
  const token = randomUUID()
  sessions.set(token, { userId, expiresAt: Date.now() + 86_400_000 })
  return token
}

function getSession(token: string | undefined) {
  if (!token) return null
  const session = sessions.get(token)
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token)
    return null
  }
  return session
}

function readToken(request: FastifyRequest, cookieName: string): string | undefined {
  const raw = request.headers.cookie ?? ''
  const match = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
  return match?.split('=')[1]
}

export async function startCoreServer(port = 5242) {
  const config = await loadConfig({
    env: {
      CORE_STORES: 'local',
      MAIL_TRANSPORT_URL: 'console://',
      MAIL_FROM: 'minimal@local',
      PORT: String(port),
      BETTER_AUTH_URL: `http://localhost:${port}`,
      LOG_LEVEL: 'info',
      APP_ID,
      APP_NAME: 'Boring Minimal',
    },
    allowMissingSecrets: true,
  })

  const userStore = new LocalUserStore()
  const workspaceStore = new LocalWorkspaceStore(userStore)

  userStore.seed({
    id: DEV_USER_ID,
    email: DEV_USER_EMAIL,
    name: DEV_USER_NAME,
    emailVerified: true,
    image: null,
  })

  const defaultWorkspace = await workspaceStore.create(
    DEV_USER_ID,
    'Default workspace',
    APP_ID,
    { isDefault: true },
  )

  const app = await createCoreApp(config, { manageShutdown: true })
  app.decorate('workspaceStore', workspaceStore)

  const cookieName = `${APP_ID}.session_token`
  const publicRoutes = [/^\/auth\//, /^\/health$/, /^\/api\/v1\/config$/]

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    request.user = null

    const token = readToken(request, cookieName)
    const session = getSession(token)
    if (session) {
      const user = await userStore.getById(session.userId)
      if (user) {
        request.user = {
          id: user.id,
          email: user.email,
          name: user.name,
        }
      }
    }

    const path = request.url.split('?')[0]
    if (
      path.startsWith('/api/v1/')
      && !publicRoutes.some((re) => re.test(path))
      && !request.user
    ) {
      return reply.status(401).send({
        error: 'unauthorized',
        code: 'unauthorized',
        message: 'Authentication required',
      })
    }
  })

  app.post('/auth/sign-in/email', async (request, reply) => {
    const body = request.body as { email?: string; password?: string } | null
    if (!body?.email || !body?.password) {
      reply.status(400)
      return { error: { message: 'Email and password required' } }
    }

    const user = await userStore.getByEmail(body.email)
    if (!user || body.password !== DEV_PASSWORD) {
      reply.status(401)
      return { error: { status: 401, message: 'Invalid email or password' } }
    }

    const token = createSession(user.id)
    reply.header(
      'set-cookie',
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
    )

    return {
      data: {
        user: { id: user.id, email: user.email, name: user.name, image: user.image },
        session: {
          id: token,
          userId: user.id,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
      error: null,
    }
  })

  app.get('/auth/get-session', async (request) => {
    const token = readToken(request, cookieName)
    const session = getSession(token)
    if (!session) {
      return { data: null, error: null }
    }

    const user = await userStore.getById(session.userId)
    if (!user) {
      return { data: null, error: null }
    }

    return {
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          emailVerified: user.emailVerified,
        },
        session: {
          id: token,
          userId: user.id,
          expiresAt: new Date(session.expiresAt).toISOString(),
        },
      },
      error: null,
    }
  })

  app.post('/auth/sign-out', async (request, reply) => {
    const token = readToken(request, cookieName)
    if (token) sessions.delete(token)

    reply.header(
      'set-cookie',
      `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    )

    return { data: null, error: null }
  })

  app.post('/auth/sign-up/email', async (_request, reply) => {
    reply.status(403)
    return { error: { message: 'Sign-up disabled in minimal mode' } }
  })

  await app.register(registerRoutes, { userStore, workspaceStore })
  await app.register(registerWorkspaceRoutes)

  await app.listen({ port, host: '127.0.0.1' })
  app.log.info(
    {
      port,
      appId: APP_ID,
      defaultWorkspaceId: defaultWorkspace.id,
      devUser: DEV_USER_EMAIL,
    },
    'minimal core server ready',
  )

  return { app, defaultWorkspaceId: defaultWorkspace.id }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const port = Number(process.env.CORE_PORT) || 5242
  startCoreServer(port).catch((error) => {
    console.error('Failed to start minimal core server:', error)
    process.exit(1)
  })
}

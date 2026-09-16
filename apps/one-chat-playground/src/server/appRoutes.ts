import type { FastifyInstance } from 'fastify'

import type { AppRegistry, OneChatApp } from './appRegistry.js'

export const APPS_ROUTE = '/api/one-chat/apps'

export interface OneChatAppView extends OneChatApp {
  readonly url: string
  readonly candidateUrl: string
}

function view(registry: AppRegistry, app: OneChatApp): OneChatAppView {
  return { ...app, url: registry.urlFor(app), candidateUrl: registry.candidateUrlFor(app) }
}

export function registerAppRoutes(
  app: FastifyInstance,
  registry: AppRegistry,
  options: { readonly onAcceptedShown?: (slug: string) => void } = {},
): void {
  app.get(APPS_ROUTE, async () => ({ apps: registry.list().map((entry) => view(registry, entry)) }))

  app.post(APPS_ROUTE, async (request, reply) => {
    const title = request.body && typeof request.body === 'object' && 'title' in request.body
      ? (request.body as { title?: unknown }).title
      : undefined
    if (typeof title !== 'string' || !title.trim()) {
      return reply.code(400).send({ error: 'invalid_title', message: 'An app title is required' })
    }
    try {
      const created = await registry.create(title)
      return reply.code(201).send(view(registry, created))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = message.startsWith('No app port') ? 409 : message.includes('80 characters') ? 400 : 500
      return reply.code(status).send({ error: 'app_create_failed', message })
    }
  })

  app.get<{ Params: { slug: string } }>(`${APPS_ROUTE}/:slug`, async (request, reply) => {
    const found = registry.get(request.params.slug)
    if (!found) return reply.code(404).send({ error: 'app_not_found', message: 'App not found' })
    return view(registry, found)
  })

  app.post<{ Params: { slug: string } }>(`${APPS_ROUTE}/:slug/undo`, async (request, reply) => {
    const found = registry.get(request.params.slug)
    if (!found) return reply.code(404).send({ error: 'app_not_found', message: 'App not found' })
    const result = await registry.lifecycleFor(found.slug).undoChange({
      sessionId: 'shell-undo',
      model: `${process.env.BORING_AGENT_DEFAULT_MODEL_PROVIDER ?? 'unknown'}/${process.env.BORING_AGENT_DEFAULT_MODEL_ID ?? 'unknown'}`,
    })
    if (result.ok) options.onAcceptedShown?.(found.slug)
    return reply.code(result.ok ? 200 : 409).send(result)
  })
}

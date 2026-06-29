import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { requireWorkspaceMember } from '../auth/requireWorkspaceMember.js'
import { createInboxItemBody, listInboxItemsQuery, patchInboxItemBody, patchInboxViewStateBody } from './__schemas__/inbox.js'

function validationError(message: string, requestId: string) {
  return new HttpError({ status: 400, code: ERROR_CODES.INBOX_INVALID_REQUEST, message, requestId })
}

function harnessTokens(): Map<string, string> {
  const raw = process.env.BORING_INBOX_HARNESS_TOKENS ?? ''
  const entries = raw.split(',').map((part) => part.trim()).filter(Boolean)
  return new Map(entries.map((entry) => {
    const [workspaceId, token] = entry.split(':')
    return [workspaceId, token] as const
  }).filter(([workspaceId, token]) => Boolean(workspaceId && token)))
}

async function requireInboxCreateAccess(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string }
  const token = request.headers['x-boring-inbox-harness-token']
  if (typeof token === 'string' && harnessTokens().get(id) === token) {
    const workspace = await request.server.workspaceStore.get(id)
    if (!workspace || workspace.appId !== request.server.config.appId) {
      throw new HttpError({ status: 404, code: ERROR_CODES.INBOX_NOT_FOUND, message: 'Workspace not found', requestId: request.id })
    }
    return
  }
  return (requireWorkspaceMember('editor') as (request: FastifyRequest, reply: FastifyReply) => Promise<void>)(request, reply)
}

const inboxRoutesPlugin: FastifyPluginAsync = async (app) => {
  const store = app.workspaceStore

  app.get(
    '/api/v1/workspaces/:id/inbox/items',
    { preHandler: requireWorkspaceMember() },
    async (request) => {
      const { id } = request.params as { id: string }
      const parsed = listInboxItemsQuery.safeParse(request.query ?? {})
      if (!parsed.success) {
        throw validationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '), request.id)
      }
      return store.listInboxItems(id, request.user!.id, parsed.data)
    },
  )

  app.post(
    '/api/v1/workspaces/:id/inbox/items',
    { preHandler: requireInboxCreateAccess },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const idempotencyKey = request.headers['idempotency-key']
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
        throw validationError('Idempotency-Key header is required', request.id)
      }
      const parsed = createInboxItemBody.safeParse(request.body)
      if (!parsed.success) {
        throw validationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '), request.id)
      }
      const source = parsed.data.source
      const result = await store.createInboxItem(id, {
        kind: parsed.data.kind,
        title: parsed.data.title,
        description: parsed.data.description,
        sourceType: source.type,
        sourceId: source.type === 'review' ? source.reviewId : source.externalId,
        sourceLabel: source.label,
        sessionId: parsed.data.sessionId ?? null,
        targetLabel: parsed.data.targetLabel ?? '',
        artifact: parsed.data.artifact ?? null,
        priority: parsed.data.priority ?? 0,
        actions: parsed.data.actions ?? [],
      }, idempotencyKey)
      if (result.conflict === 'idempotency') {
        throw new HttpError({ status: 409, code: ERROR_CODES.INBOX_IDEMPOTENCY_CONFLICT, message: 'Idempotency key already used with a different body', requestId: request.id })
      }
      if (result.conflict === 'source') {
        throw new HttpError({ status: 409, code: ERROR_CODES.INBOX_CONFLICT, message: 'Inbox source already exists with a different idempotency key', requestId: request.id })
      }
      if (result.created) reply.code(201)
      return result
    },
  )

  app.patch(
    '/api/v1/workspaces/:id/inbox/items/:itemId',
    { preHandler: requireWorkspaceMember('editor') },
    async (request) => {
      const { id, itemId } = request.params as { id: string; itemId: string }
      const parsed = patchInboxItemBody.safeParse(request.body)
      if (!parsed.success) {
        throw validationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '), request.id)
      }
      const item = await store.updateInboxItemStatus(id, itemId, parsed.data.status)
      if (!item) throw new HttpError({ status: 404, code: ERROR_CODES.INBOX_NOT_FOUND, message: 'Inbox item not found', requestId: request.id })
      return { item }
    },
  )

  app.patch(
    '/api/v1/workspaces/:id/inbox/items/:itemId/view-state',
    { preHandler: requireWorkspaceMember() },
    async (request) => {
      const { id, itemId } = request.params as { id: string; itemId: string }
      const parsed = patchInboxViewStateBody.safeParse(request.body)
      if (!parsed.success) {
        throw validationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '), request.id)
      }
      const viewState = await store.putInboxItemViewState(id, request.user!.id, itemId, parsed.data)
      if (!viewState) throw new HttpError({ status: 404, code: ERROR_CODES.INBOX_NOT_FOUND, message: 'Inbox item not found', requestId: request.id })
      return { viewState }
    },
  )
}

export const registerInboxRoutes = fp(inboxRoutesPlugin, { name: 'inbox-routes' })

/**
 * UI State HTTP routes at /api/v1/ui/*.
 * In-memory state persistence for workspace panel layout.
 */
import type { FastifyInstance } from 'fastify'

// HTTP error helpers (avoids @fastify/sensible dependency)
function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number }
  err.statusCode = statusCode
  return err
}
const httpErrors = {
  badRequest: (msg: string) => httpError(400, msg),
  notFound: (msg: string) => httpError(404, msg),
  conflict: (msg: string) => httpError(409, msg),
}
import {
  upsertState,
  getState,
  getLatestState,
  listStates,
  deleteState,
  clearStates,
  enqueueCommand,
  popNextCommand,
  listOpenPanels,
  resolveClientId,
  type UiCommandPayload,
  type UiStateSnapshot,
} from '../services/uiStateImpl.js'
import { resolveUiWorkspaceKey } from '../agent/sessionContext.js'

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export async function registerUiStateRoutes(app: FastifyInstance): Promise<void> {
  const getKey = (payload: Record<string, unknown> = {}, workspaceIdHeader?: string) => (
    resolveUiWorkspaceKey(app.config, payload, workspaceIdHeader)
  )

  const normalizeSnapshot = (body: Record<string, unknown>): UiStateSnapshot => {
    const openPanels = Array.isArray(body.open_panels)
      ? body.open_panels
      : (Array.isArray(body.panes) ? body.panes : [])
    const activePanelId = typeof body.active_panel_id === 'string'
      ? body.active_panel_id
      : (typeof body.active_panel === 'string' ? body.active_panel : null)
    const meta = asRecord(body.meta)
    const metadata = Object.keys(meta).length > 0 ? meta : asRecord(body.metadata)

    return {
      ...body,
      client_id: String(body.client_id || '').trim(),
      active_panel_id: activePanelId,
      open_panels: openPanels as Record<string, unknown>[],
      project_root: typeof body.project_root === 'string' ? body.project_root : null,
      meta: metadata,
      panes: openPanels,
      active_panel: activePanelId,
      metadata,
    }
  }

  const normalizeCommand = (body: Record<string, unknown>): UiCommandPayload | null => {
    const source = asRecord(body.command)
    const commandSource = Object.keys(source).length > 0 ? source : body
    const legacyType = typeof body.type === 'string' ? body.type.trim() : ''
    const legacyPayload = asRecord(body.payload)
    const kind = typeof commandSource.kind === 'string'
      ? commandSource.kind.trim()
      : legacyType
    if (!kind) return null

    const params = asRecord(commandSource.params)
    return {
      ...legacyPayload,
      ...commandSource,
      kind,
      params: Object.keys(params).length > 0 ? params : asRecord(legacyPayload.params),
      prefer_existing: commandSource.prefer_existing !== false,
      meta: asRecord(commandSource.meta),
    }
  }

  const validateCommand = (
    workspaceKey: string,
    command: UiCommandPayload,
    targetClientId: string,
  ): UiCommandPayload => {
    const kind = String(command.kind || '').trim()
    if (!['focus_panel', 'open_panel'].includes(kind)) {
      throw httpErrors.badRequest('Unsupported command kind. Supported: focus_panel, open_panel')
    }

    if (kind === 'focus_panel') {
      const panelId = String(command.panel_id || '').trim()
      if (!panelId) {
        throw httpErrors.badRequest('focus_panel requires panel_id')
      }
      const paneState = listOpenPanels(workspaceKey, targetClientId)
      const panelIds = new Set(
        (paneState?.open_panels || [])
          .map((panel) => String(panel?.id || '').trim())
          .filter(Boolean),
      )
      if (!panelIds.has(panelId)) {
        throw httpErrors.conflict(
          `Panel '${panelId}' is not currently open for client_id '${targetClientId}'`,
        )
      }
      return {
        ...command,
        kind,
        panel_id: panelId,
      }
    }

    const component = String(command.component || '').trim()
    if (!component) {
      throw httpErrors.badRequest('open_panel requires component')
    }
    return {
      ...command,
      kind,
      component,
    }
  }

  app.put('/ui/state', async (request) => {
    const body = asRecord(request.body)
    const state = upsertState(
      getKey(body, request.headers['x-workspace-id'] as string | undefined),
      normalizeSnapshot(body),
    )
    return { ok: true, state }
  })

  app.post('/ui/state', async (request) => {
    const body = asRecord(request.body)
    const state = upsertState(
      getKey(body, request.headers['x-workspace-id'] as string | undefined),
      normalizeSnapshot(body),
    )
    return { ok: true, state }
  })

  app.get('/ui/state', async (request) => {
    const workspaceKey = getKey({}, request.headers['x-workspace-id'] as string | undefined)
    const states = listStates(workspaceKey)
    return { ok: true, states, count: states.length }
  })

  app.get('/ui/state/latest', async (request, reply) => {
    const workspaceKey = getKey({}, request.headers['x-workspace-id'] as string | undefined)
    const state = getLatestState(workspaceKey)
    if (!state) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'No frontend state has been published',
      })
    }
    return { ok: true, state }
  })

  app.get<{ Params: { clientId: string } }>('/ui/state/:clientId', async (request, reply) => {
    const workspaceKey = getKey({}, request.headers['x-workspace-id'] as string | undefined)
    const state = getState(workspaceKey, request.params.clientId)
    if (!state) {
      return reply.code(404).send({
        error: 'not_found',
        message: `State for client_id '${request.params.clientId}' not found`,
      })
    }
    return { ok: true, state }
  })

  app.delete<{ Params: { clientId: string } }>('/ui/state/:clientId', async (request, reply) => {
    const workspaceKey = getKey({}, request.headers['x-workspace-id'] as string | undefined)
    const deleted = deleteState(workspaceKey, request.params.clientId)
    if (!deleted) {
      return reply.code(404).send({
        error: 'not_found',
        message: `State for client_id '${request.params.clientId}' not found`,
      })
    }
    return { ok: true, deleted: request.params.clientId }
  })

  app.delete('/ui/state', async (request) => {
    const workspaceKey = getKey({}, request.headers['x-workspace-id'] as string | undefined)
    return { ok: true, cleared: clearStates(workspaceKey) }
  })

  app.get('/ui/panes', async (request, reply) => {
    const { client_id } = request.query as { client_id?: string }
    const workspaceKey = getKey({}, request.headers['x-workspace-id'] as string | undefined)
    const panes = listOpenPanels(workspaceKey, client_id)
    if (!panes) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'No frontend state has been published',
      })
    }
    return { ok: true, ...panes }
  })

  app.get<{ Params: { clientId: string } }>('/ui/panes/:clientId', async (request, reply) => {
    const workspaceKey = getKey({}, request.headers['x-workspace-id'] as string | undefined)
    const panes = listOpenPanels(workspaceKey, request.params.clientId)
    if (!panes) {
      return reply.code(404).send({
        error: 'not_found',
        message: `State for client_id '${request.params.clientId}' not found`,
      })
    }
    return { ok: true, ...panes }
  })

  app.post('/ui/commands', async (request) => {
    const body = asRecord(request.body)
    const workspaceKey = getKey(body, request.headers['x-workspace-id'] as string | undefined)
    const targetClientId = resolveClientId(
      workspaceKey,
      typeof body.client_id === 'string' ? body.client_id : null,
    )
    if (!targetClientId) {
      throw httpErrors.notFound('No frontend state client is available')
    }
    const command = normalizeCommand(body)
    if (!command) {
      throw httpErrors.badRequest('command.kind is required')
    }
    const queued = enqueueCommand(
      workspaceKey,
      validateCommand(workspaceKey, command, targetClientId),
      targetClientId,
    )
    if (!queued) {
      throw httpErrors.notFound(`State for client_id '${targetClientId}' not found`)
    }
    return { ok: true, command: queued }
  })

  app.get('/ui/commands/next', async (request) => {
    const { client_id } = request.query as { client_id?: string }
    const workspaceKey = getKey({}, request.headers['x-workspace-id'] as string | undefined)
    const command = popNextCommand(workspaceKey, client_id || '')
    return { ok: true, command }
  })

  app.post('/ui/focus', async (request) => {
    const body = asRecord(request.body)
    const workspaceKey = getKey(body, request.headers['x-workspace-id'] as string | undefined)
    const targetClientId = resolveClientId(
      workspaceKey,
      typeof body.client_id === 'string' ? body.client_id : null,
    )
    if (!targetClientId) {
      throw httpErrors.notFound('No frontend state client is available')
    }
    const queued = enqueueCommand(
      workspaceKey,
      validateCommand(workspaceKey, {
        kind: 'focus_panel',
        panel_id: String(body.panel_id || ''),
      }, targetClientId),
      targetClientId,
    )
    if (!queued) {
      throw httpErrors.notFound(`State for client_id '${targetClientId}' not found`)
    }
    return { ok: true, command: queued }
  })
}

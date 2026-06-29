import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify'
import { registerInboxRoutes } from '../inbox'
import { registerErrorHandler } from '../../app/errorHandler'
import type { WorkspaceStore } from '../../app/types'
import type { MemberRole, Workspace, WorkspaceInboxItem, WorkspaceInboxItemInput, WorkspaceInboxItemStatus, WorkspaceInboxItemViewState } from '../../../shared/types'

const OWNER_ID = '00000000-0000-0000-0000-000000000001'
const EDITOR_ID = '00000000-0000-0000-0000-000000000002'
const VIEWER_ID = '00000000-0000-0000-0000-000000000003'
const NON_MEMBER_ID = '00000000-0000-0000-0000-000000000004'
const WS_ID = '00000000-0000-0000-0000-0000000000aa'
const OTHER_WS_ID = '00000000-0000-0000-0000-0000000000bb'
const APP_ID = 'test-app'

let app: FastifyInstance
const members = new Map<string, Map<string, MemberRole>>()
const items = new Map<string, WorkspaceInboxItem>()
const idempotency = new Map<string, { itemId: string; hash: string }>()
const viewStates = new Map<string, WorkspaceInboxItemViewState>()
let seq = 0

function hash(input: unknown): string {
  return JSON.stringify(input)
}

function resetState() {
  seq = 0
  items.clear()
  idempotency.clear()
  viewStates.clear()
  members.clear()
  members.set(WS_ID, new Map([[OWNER_ID, 'owner'], [EDITOR_ID, 'editor'], [VIEWER_ID, 'viewer']]))
  members.set(OTHER_WS_ID, new Map([[OWNER_ID, 'owner']]))
  process.env.BORING_INBOX_HARNESS_TOKENS = `${WS_ID}:secret-token`
}

function mockStore(): WorkspaceStore {
  return {
    get: async (id: string): Promise<Workspace | null> => id === WS_ID || id === OTHER_WS_ID
      ? { id, appId: APP_ID, name: 'Workspace', createdBy: OWNER_ID, createdAt: new Date().toISOString(), deletedAt: null, isDefault: false }
      : null,
    getMemberRole: async (workspaceId: string, userId: string) => members.get(workspaceId)?.get(userId) ?? null,
    isMember: async (workspaceId: string, userId: string) => members.get(workspaceId)?.has(userId) ?? false,
    listInboxItems: async (workspaceId: string, userId: string, filters: { status?: WorkspaceInboxItemStatus | 'all'; kind?: WorkspaceInboxItem['kind'] } = {}) => {
      const status = filters.status ?? 'open'
      return {
        items: Array.from(items.values())
          .filter((item) => item.workspaceId === workspaceId)
          .filter((item) => status === 'all' || item.status === status)
          .filter((item) => !filters.kind || item.kind === filters.kind)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        viewState: Array.from(viewStates.entries()).filter(([key]) => key.startsWith(`${workspaceId}:${userId}:`)).map(([, value]) => value),
      }
    },
    createInboxItem: async (workspaceId: string, input: WorkspaceInboxItemInput, idempotencyKey: string) => {
      const key = `${workspaceId}:${idempotencyKey}`
      const inputHash = hash(input)
      const existing = idempotency.get(key)
      if (existing) {
        return { item: items.get(existing.itemId)!, created: false, ...(existing.hash === inputHash ? {} : { conflict: 'idempotency' as const }) }
      }
      const sourceExisting = Array.from(items.values()).find((item) => item.workspaceId === workspaceId && item.sourceType === input.sourceType && item.sourceId === input.sourceId)
      if (sourceExisting) return { item: sourceExisting, created: false, conflict: 'source' as const }
      const now = new Date(Date.UTC(2026, 0, 1, 0, 0, seq++)).toISOString()
      const item: WorkspaceInboxItem = {
        id: `item-${seq}`,
        workspaceId,
        kind: input.kind,
        status: 'open',
        title: input.title,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLabel: input.sourceLabel,
        sessionId: input.sessionId ?? null,
        targetLabel: input.targetLabel ?? '',
        artifact: input.artifact ?? null,
        priority: input.priority ?? 0,
        actions: input.actions ?? [],
        createdAt: now,
        updatedAt: now,
      }
      items.set(item.id, item)
      idempotency.set(key, { itemId: item.id, hash: inputHash })
      return { item, created: true }
    },
    updateInboxItemStatus: async (workspaceId: string, itemId: string, status: WorkspaceInboxItemStatus) => {
      const item = items.get(itemId)
      if (!item || item.workspaceId !== workspaceId) return null
      const updated = { ...item, status, updatedAt: new Date().toISOString() }
      items.set(itemId, updated)
      return updated
    },
    putInboxItemViewState: async (workspaceId: string, userId: string, itemId: string, state: { pinned?: boolean }) => {
      const item = items.get(itemId)
      if (!item || item.workspaceId !== workspaceId) return null
      const viewState = { itemId, pinned: state.pinned ?? false }
      viewStates.set(`${workspaceId}:${userId}:${itemId}`, viewState)
      return viewState
    },
  } as unknown as WorkspaceStore
}

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.decorate('config', { appId: APP_ID } as any)
  app.decorate('workspaceStore', mockStore())
  app.decorate('provisioner', null)
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    const userId = request.headers['x-test-user'] as string | undefined
    request.user = userId ? { id: userId, email: `${userId}@test.dev`, name: null, emailVerified: true } : null
  })
  await app.register(registerInboxRoutes)
  await app.ready()
})

afterAll(async () => {
  delete process.env.BORING_INBOX_HARNESS_TOKENS
  await app.close()
})

beforeEach(resetState)

function inject(method: 'GET' | 'POST' | 'PATCH', url: string, userId?: string, payload?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
  return app.inject({ method, url, headers: { ...(userId ? { 'x-test-user': userId } : {}), ...headers }, payload: payload as never })
}

const createPayload = {
  kind: 'question',
  title: 'Need owner input',
  description: 'Safe display text',
  source: { type: 'external-hook', externalId: 'hook-1', label: 'Harness' },
  targetLabel: 'PR #380',
} as const

describe('workspace inbox routes', () => {
  it('creates durable inbox items with idempotency and lists open items by default', async () => {
    const created = await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, EDITOR_ID, createPayload, { 'idempotency-key': 'k1' })
    expect(created.statusCode).toBe(201)
    expect(created.json().created).toBe(true)

    await inject('PATCH', `/api/v1/workspaces/${WS_ID}/inbox/items/${created.json().item.id}`, EDITOR_ID, { status: 'resolved' })
    const defaultList = await inject('GET', `/api/v1/workspaces/${WS_ID}/inbox/items`, VIEWER_ID)
    expect(defaultList.json().items).toHaveLength(0)
    const allList = await inject('GET', `/api/v1/workspaces/${WS_ID}/inbox/items?status=all`, VIEWER_ID)
    expect(allList.json().items).toHaveLength(1)
  })

  it('returns the same item for repeated idempotency and source ids', async () => {
    const first = await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, EDITOR_ID, createPayload, { 'idempotency-key': 'k1' })
    const retry = await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, EDITOR_ID, createPayload, { 'idempotency-key': 'k1' })
    const sameSource = await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, EDITOR_ID, { ...createPayload, title: 'Other' }, { 'idempotency-key': 'k2' })
    expect(retry.json()).toMatchObject({ created: false, item: { id: first.json().item.id } })
    expect(sameSource.statusCode).toBe(409)
    expect(sameSource.json().code).toBe('inbox_conflict')
  })

  it('returns inbox-specific errors for invalid requests and idempotency conflicts', async () => {
    const missingKey = await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, EDITOR_ID, createPayload)
    expect(missingKey.statusCode).toBe(400)
    expect(missingKey.json().code).toBe('inbox_invalid_request')

    await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, EDITOR_ID, createPayload, { 'idempotency-key': 'k1' })
    const conflict = await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, EDITOR_ID, { ...createPayload, source: { type: 'external-hook', externalId: 'hook-2', label: 'Harness' } }, { 'idempotency-key': 'k1' })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().code).toBe('inbox_idempotency_conflict')
  })

  it('enforces workspace membership for user requests and accepts scoped harness token creates', async () => {
    const viewer = await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, VIEWER_ID, createPayload, { 'idempotency-key': 'k1' })
    expect(viewer.statusCode).toBe(403)

    const nonMemberRead = await inject('GET', `/api/v1/workspaces/${WS_ID}/inbox/items`, NON_MEMBER_ID)
    expect(nonMemberRead.statusCode).toBe(403)

    const harness = await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, undefined, createPayload, {
      'idempotency-key': 'k-harness',
      'x-boring-inbox-harness-token': 'secret-token',
    })
    expect(harness.statusCode).toBe(201)
  })

  it('updates per-user pin view state without mutating canonical items', async () => {
    const created = await inject('POST', `/api/v1/workspaces/${WS_ID}/inbox/items`, EDITOR_ID, createPayload, { 'idempotency-key': 'k1' })
    const itemId = created.json().item.id
    const pinned = await inject('PATCH', `/api/v1/workspaces/${WS_ID}/inbox/items/${itemId}/view-state`, VIEWER_ID, { pinned: true })
    expect(pinned.json().viewState).toEqual({ itemId, pinned: true })
    const list = await inject('GET', `/api/v1/workspaces/${WS_ID}/inbox/items`, VIEWER_ID)
    expect(list.json().items[0].pinned).toBeUndefined()
    expect(list.json().viewState).toEqual([{ itemId, pinned: true }])
  })
})

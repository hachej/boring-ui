import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import {
  InMemoryPiSessionMetadataIndex,
  PiSessionAccessError,
  PiSessionIdentityService,
  type PiSessionRecord,
  type PiSessionRepository,
  type PiSessionRequestContext,
} from '../piSessionIdentity'

class FakePiSessionRepository implements PiSessionRepository {
  records = new Map<string, PiSessionRecord>()
  deleted: string[] = []

  async list(): Promise<PiSessionRecord[]> {
    return Array.from(this.records.values())
  }

  async create(init?: { title?: string }): Promise<PiSessionRecord> {
    const id = `pi-${this.records.size + 1}`
    const now = new Date(1_700_000_000_000 + this.records.size).toISOString()
    const record: PiSessionRecord = {
      sessionId: id,
      title: init?.title,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
    }
    this.records.set(id, record)
    return record
  }

  async delete(sessionId: string): Promise<void> {
    this.deleted.push(sessionId)
    this.records.delete(sessionId)
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.records.has(sessionId)
  }
}

const workspaceA: PiSessionRequestContext = {
  workspaceId: 'workspace-a',
  requestId: 'request-a',
  storageScope: 'scope-a',
}

const workspaceB: PiSessionRequestContext = {
  workspaceId: 'workspace-b',
  requestId: 'request-b',
  storageScope: 'scope-b',
}

describe('PiSessionIdentityService', () => {
  it('uses the Pi session id as the user-visible id and stores metadata without transcript messages', async () => {
    const repository = new FakePiSessionRepository()
    const metadata = new InMemoryPiSessionMetadataIndex()
    const service = new PiSessionIdentityService({ repository, metadata })

    const created = await service.create(workspaceA, { title: 'Analysis', modelDefault: { provider: 'anthropic', id: 'claude' } })

    expect(created.id).toBe('pi-1')
    expect(created.title).toBe('Analysis')
    expect(await metadata.get('pi-1')).toEqual({
      sessionId: 'pi-1',
      workspaceId: 'workspace-a',
      storageScope: 'scope-a',
      title: 'Analysis',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      modelDefault: { provider: 'anthropic', id: 'claude' },
    })
    expect(JSON.stringify(await metadata.get('pi-1'))).not.toMatch(/messages|transcript|parts/)
  })

  it('lists only sessions owned by the resolved workspace and keeps a streamed session exactly once', async () => {
    const repository = new FakePiSessionRepository()
    const metadata = new InMemoryPiSessionMetadataIndex()
    const service = new PiSessionIdentityService({ repository, metadata })

    const a = await service.create(workspaceA, { title: 'A' })
    await service.create(workspaceB, { title: 'B' })
    repository.records.set(a.id, { ...repository.records.get(a.id)!, title: 'Pi title from active stream', isStreaming: true, updatedAt: '2026-01-01T00:00:00.000Z' })

    const listed = await service.list(workspaceA, { activeSessionId: a.id })

    expect(listed.map((session) => session.id)).toEqual([a.id])
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: a.id, title: 'A', turnCount: 0 })
  })

  it('verifies workspace and storage-scope ownership before allowing future state, command, and stream methods', async () => {
    const service = new PiSessionIdentityService({ repository: new FakePiSessionRepository(), metadata: new InMemoryPiSessionMetadataIndex() })
    const created = await service.create(workspaceA, { title: 'Owned by A' })

    await expect(service.assertCanAccess(workspaceA, created.id)).resolves.toEqual(expect.objectContaining({ sessionId: created.id }))
    await expect(service.assertCanAccess(workspaceB, created.id)).rejects.toMatchObject({
      name: 'PiSessionAccessError',
      code: ErrorCode.enum.SESSION_NOT_FOUND,
      sessionId: created.id,
    })
    await expect(service.assertCanAccess({ ...workspaceA, storageScope: 'other-scope' }, created.id)).rejects.toMatchObject({
      name: 'PiSessionAccessError',
      code: ErrorCode.enum.SESSION_NOT_FOUND,
      sessionId: created.id,
    })
  })

  it('deletes the Pi session and its thin metadata entry', async () => {
    const repository = new FakePiSessionRepository()
    const metadata = new InMemoryPiSessionMetadataIndex()
    const service = new PiSessionIdentityService({ repository, metadata })
    const created = await service.create(workspaceA, { title: 'Delete me' })

    await service.delete(workspaceA, created.id)

    expect(repository.deleted).toEqual([created.id])
    expect(await metadata.get(created.id)).toBeUndefined()
    await expect(service.assertCanAccess(workspaceA, created.id)).rejects.toBeInstanceOf(PiSessionAccessError)
  })

  it('preserves active reload session identity when the persisted active id is still valid', async () => {
    const repository = new FakePiSessionRepository()
    const metadata = new InMemoryPiSessionMetadataIndex()
    const service = new PiSessionIdentityService({ repository, metadata })
    const created = await service.create(workspaceA, { title: 'Running' })
    repository.records.set(created.id, { ...repository.records.get(created.id)!, isStreaming: true })

    const active = await service.resolveActiveSession(workspaceA, created.id)
    const listed = await service.list(workspaceA, { activeSessionId: created.id })

    expect(active?.id).toBe(created.id)
    expect(listed.filter((session) => session.id === created.id)).toHaveLength(1)
  })

  it('falls back safely when the persisted active id is invalid or belongs to another workspace', async () => {
    const service = new PiSessionIdentityService({ repository: new FakePiSessionRepository(), metadata: new InMemoryPiSessionMetadataIndex() })
    const created = await service.create(workspaceA, { title: 'Fallback' })
    const other = await service.create(workspaceB, { title: 'Other workspace' })

    await expect(service.resolveActiveSession(workspaceA, 'missing')).resolves.toEqual(created)
    await expect(service.resolveActiveSession(workspaceA, other.id)).resolves.toEqual(created)
  })
})

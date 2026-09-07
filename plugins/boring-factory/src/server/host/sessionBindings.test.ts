import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FactoryEpicEntry, FactoryEpicRegistry } from './epicRegistry'
import { createFactorySessionBindings, resolveFactoryEpic } from './sessionBindings'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

function registryFor(entry: FactoryEpicEntry): FactoryEpicRegistry {
  return {
    load: async () => [entry],
    list: async () => [entry],
    get: async (key) => key === entry.epicKey ? entry : undefined,
    register: async () => entry,
    setOrchestratorSession: async () => entry,
    markClosed: async () => ({ ...entry, status: 'closed' }),
  }
}

describe('factory session bindings', () => {
  it('persists bindings and lets a child inherit its parent epic', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'factory-bindings-'))
    temporaryRoots.push(stateRoot)
    const bindings = createFactorySessionBindings(stateRoot)
    await bindings.bind('parent', 'epic-one')
    await expect(bindings.inherit('parent', 'child')).resolves.toBe('epic-one')
    await expect(bindings.bind('child', 'epic-two')).rejects.toMatchObject({
      code: 'SESSION_ALREADY_BOUND',
      epicKey: 'epic-one',
    })

    const reloaded = createFactorySessionBindings(stateRoot)
    await expect(reloaded.load()).resolves.toEqual({ parent: 'epic-one', child: 'epic-one' })
    await reloaded.unbind('parent')
    await expect(reloaded.get('parent')).resolves.toBeUndefined()
  })

  it('requires an explicit epicKey for an unbound session and accepts the override', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'factory-bindings-'))
    temporaryRoots.push(stateRoot)
    const bindings = createFactorySessionBindings(stateRoot)
    const entry: FactoryEpicEntry = {
      epicKey: 'epic-one', featureName: 'Epic One', worktree: '/worktree', branch: 'epic/epic-one',
      repositoryRoot: '/repository', createdAt: '2026-09-05T00:00:00.000Z', status: 'active',
    }
    const ctx = { abortSignal: new AbortController().signal, toolCallId: 'call-1', sessionId: 'unbound' }
    await expect(resolveFactoryEpic({}, ctx, registryFor(entry), bindings)).rejects.toMatchObject({
      code: 'EPIC_BINDING_REQUIRED',
      message: expect.stringContaining('epicKey'),
    })
    await expect(resolveFactoryEpic({ epicKey: 'epic-one' }, ctx, registryFor(entry), bindings)).resolves.toEqual(entry)
  })
})

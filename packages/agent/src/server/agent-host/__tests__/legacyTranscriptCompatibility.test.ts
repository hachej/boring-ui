import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getEnv, restoreEnvForTest, setEnvForTest } from '../../config/env'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'

const roots: string[] = []
const originalSessionRoot = getEnv('BORING_AGENT_SESSION_ROOT')
const originalHome = getEnv('HOME')

afterEach(async () => {
  restoreEnvForTest('BORING_AGENT_SESSION_ROOT', originalSessionRoot)
  restoreEnvForTest('HOME', originalHome)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function root(prefix: string) {
  const value = await mkdtemp(join(tmpdir(), prefix))
  roots.push(value)
  return value
}

async function proveSameBytes(store: PiSessionStore) {
  const ctx = { workspaceId: 'workspace-a' }
  const created = await store.create(ctx, { title: 'pre-AH0 fixture' })
  const path = join(store.getSessionDir(), `${created.id}.jsonl`)
  const before = await readFile(path)
  expect((await store.list(ctx)).map((session) => session.id)).toContain(created.id)
  expect((await store.load(ctx, created.id)).title).toBe('pre-AH0 fixture')
  expect(await readFile(path)).toEqual(before)
}

describe.sequential('legacy transcript compatibility', () => {
  it('preserves an explicit sessionDir byte path', async () => {
    const sessionDir = await root('legacy-explicit-')
    await proveSameBytes(new PiSessionStore('/workspace', sessionDir))
  })

  it('preserves sessionRoot/sessionNamespace byte paths', async () => {
    const sessionRoot = await root('legacy-namespace-')
    const store = new PiSessionStore('/workspace', { sessionRoot, sessionNamespace: 'workspace-a' })
    expect(store.getSessionDir()).toBe(join(sessionRoot, 'workspace-a'))
    await proveSameBytes(store)
  })

  it('preserves the CLI defaultSessionDir branch with BORING_AGENT_SESSION_ROOT unset', async () => {
    const home = await root('legacy-home-')
    setEnvForTest('HOME', home)
    setEnvForTest('BORING_AGENT_SESSION_ROOT', undefined)
    const store = new PiSessionStore('/workspace/project')
    expect(store.getSessionDir()).toBe(join(home, '.pi', 'agent', 'sessions', '--workspace-project--'))
    await proveSameBytes(store)
  })

  it('preserves the CLI defaultSessionDir branch with BORING_AGENT_SESSION_ROOT set', async () => {
    const sessionRoot = await root('legacy-env-root-')
    setEnvForTest('BORING_AGENT_SESSION_ROOT', sessionRoot)
    const store = new PiSessionStore('/workspace/project')
    expect(store.getSessionDir()).toBe(join(sessionRoot, '--workspace-project--'))
    await proveSameBytes(store)
  })
})

import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Deterministic worst-case directory order (reverse-alphabetical): a store
// that breaks recency ties by readdir order instead of session id truncates
// away exactly the sessions the merge order ranks first. Without this mock
// the regression below depends on the host filesystem's hash order.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: ((path: Parameters<typeof actual.readdir>[0], options?: Parameters<typeof actual.readdir>[1]) =>
      Promise.resolve(actual.readdir(path, options as never)).then((entries: unknown) =>
        Array.isArray(entries)
          ? (entries as string[]).slice().sort().reverse()
          : entries,
      )) as typeof actual.readdir,
  }
})
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import type { AuthorizedAgentScope } from '../../../shared/index'
import type { SessionListOptions } from '../../../shared/session'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
import { createAgentHost } from '../createAgentHost'
import { sessionNamespaceForAgent } from '../sessionInventory'
import type { AgentHostAgentSpec } from '../types'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'agent-session-inventory-'))
  roots.push(value)
  return value
}

const legacyDefaultAgent = { agentTypeId: 'default', legacyDefault: true } as const satisfies AgentHostAgentSpec

function pathDerivedDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
}

function transcript(id: string, title: string, workspaceScopeId: string, timestamp: string): string {
  return [
    JSON.stringify({
      type: 'session',
      version: 1,
      id,
      timestamp,
      cwd: '/workspace',
      boringSessionCtx: { workspaceId: workspaceScopeId },
    }),
    JSON.stringify({ type: 'session_info', id: `info-${id}`, parentId: null, timestamp, name: title }),
    JSON.stringify({
      type: 'message',
      id: `message-${id}`,
      parentId: null,
      timestamp,
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 },
    }),
    '',
  ].join('\n')
}

/** Plants an existing transcript with a deterministic mtime so listing order is stable. */
async function plant(dir: string, id: string, title: string, workspaceScopeId: string, atMs: number): Promise<void> {
  await mkdir(dir, { recursive: true })
  const filepath = join(dir, `${id}.jsonl`)
  await writeFile(filepath, transcript(id, title, workspaceScopeId, new Date(atMs).toISOString()))
  await utimes(filepath, new Date(atMs), new Date(atMs))
}

async function startHost(input: {
  readonly agents: readonly AgentHostAgentSpec[]
  readonly sessionRoot: string
  readonly workspaceRoot: string
  readonly sessionNamespace: string
}) {
  const mode = createTestRuntimeModeAdapter('direct')
  return await createAgentHost({
    agents: input.agents,
    fleetCompiler: { async compile({ agents }) { return agents } },
    hostId: 'session-inventory-host',
    scopeVerifier: {
      async verify(candidate) {
        return { workspaceScopeId: candidate.workspaceScopeId, authSubjectId: candidate.authSubjectId }
      },
    },
    runtimeModeAdapter: mode,
    sessionRoot: input.sessionRoot,
    resolveAuthorizedEnvironmentScope: async () => ({
      placementIdentity: 'direct-a',
      workspaceRoot: input.workspaceRoot,
      provisioningFingerprint: 'provision-a',
    }),
    resolveAuthorizedAgentRuntimeScope: async ({ agentTypeId }) => ({
      identity: `${agentTypeId}:runtime`,
      physicalBindingIdentity: `${agentTypeId}:runtime`,
      resourceInputDigest: `${agentTypeId}:runtime`,
      sessionNamespace: input.sessionNamespace,
    }),
    harnessFactory: async () => { throw new Error('listing must not create a harness') },
  })
}

describe('legacyDefault seat storage placement', () => {
  it('keeps an empty runtime namespace on the cwd-derived directory both sides already use', async () => {
    const sessionRoot = await temporaryRoot()
    const workspaceRoot = join(sessionRoot, 'workspace')

    // The one function both `buildAgentComposition` (write) and
    // `AgentSessionInventory` (read) consume. `undefined` is the deliberate
    // answer, and it must keep resolving to the path-derived directory that
    // already holds users' transcripts.
    const namespace = sessionNamespaceForAgent(legacyDefaultAgent, 'workspace-a:storage-a', '')
    expect(namespace).toBeUndefined()

    const store = new PiSessionStore(workspaceRoot, {
      sessionNamespace: namespace,
      sessionRoot,
      storageCwd: workspaceRoot,
    })
    expect(store.getSessionDir()).toBe(join(sessionRoot, pathDerivedDirName(workspaceRoot)))
  })

  it('honours a host-supplied namespace for the same seat', () => {
    expect(sessionNamespaceForAgent(legacyDefaultAgent, 'workspace-a:storage-a', 'workspace-a'))
      .toBe('workspace-a')
  })

  it('still lists transcripts that already live in the cwd-derived directory', async () => {
    const sessionRoot = await temporaryRoot()
    const workspaceRoot = join(sessionRoot, 'workspace')
    const workspaceScopeId = 'workspace-a:storage-a'
    const scope = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope

    await plant(
      join(sessionRoot, pathDerivedDirName(workspaceRoot)),
      'pre-existing-session',
      'A session the user already had',
      workspaceScopeId,
      Date.UTC(2026, 6, 20),
    )

    const host = await startHost({
      agents: [legacyDefaultAgent],
      sessionRoot,
      workspaceRoot,
      sessionNamespace: '',
    })
    try {
      const page = await host.gateway.listSessions({ scope, limit: 10 })
      expect(page.sessions).toEqual([expect.objectContaining({
        ref: { agentTypeId: 'default', sessionId: 'pre-existing-session' },
        title: 'A session the user already had',
      })])
    } finally {
      await host.host.close()
    }
  })
})

describe('seat session listing pagination', () => {
  it('bounds every store read and pages without gaps or repeats', async () => {
    const sessionRoot = await temporaryRoot()
    const workspaceRoot = join(sessionRoot, 'workspace')
    const workspaceScopeId = 'workspace-a:storage-a'
    const scope = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope
    const dir = join(sessionRoot, pathDerivedDirName(workspaceRoot))
    const total = 7
    for (let index = 0; index < total; index += 1) {
      await plant(dir, `session-${index}`, `Session ${index}`, workspaceScopeId, Date.UTC(2026, 6, 20) + index * 60_000)
    }

    const listOptions: (SessionListOptions | undefined)[] = []
    const originalList = PiSessionStore.prototype.list
    vi.spyOn(PiSessionStore.prototype, 'list').mockImplementation(async function (this: PiSessionStore, ctx, options) {
      listOptions.push(options)
      return await originalList.call(this, ctx, options)
    })

    const host = await startHost({
      agents: [legacyDefaultAgent],
      sessionRoot,
      workspaceRoot,
      sessionNamespace: '',
    })
    try {
      const seen: string[] = []
      let cursor: string | undefined
      let pages = 0
      do {
        const page = await host.gateway.listSessions({ scope, agentTypeId: 'default', limit: 2, cursor })
        pages += 1
        seen.push(...page.sessions.map((summary) => summary.ref.sessionId))
        cursor = page.nextCursor
        expect(page.sessions.length).toBeLessThanOrEqual(2)
      } while (cursor && pages < 10)

      // Newest first, every session exactly once.
      expect(seen).toEqual(
        Array.from({ length: total }, (_unused, index) => `session-${total - 1 - index}`),
      )

      // The listing NEVER asks the store for the whole directory: each read is
      // bounded, and the bound only grows by the page size as paging deepens.
      expect(listOptions.length).toBe(pages)
      expect(listOptions.every((options) => typeof options?.limit === 'number')).toBe(true)
      expect(listOptions.map((options) => options!.limit)).toEqual([3, 5, 7, 9])
    } finally {
      await host.host.close()
    }
  })
})

describe('equal-updatedAt tiebreak (sessions must never disappear)', () => {
  // The gateway's bounded merge only sees each store's top prefix, so the
  // store MUST break recency ties by session id — exactly like the gateway's
  // total order. These transcripts all share one latest-message timestamp and
  // are CREATED in reverse id order, so readdir order among the ties is the
  // opposite of the required order: a store that truncates before breaking
  // ties drops low-id sessions from every page, forever.
  const SHARED_MS = Date.UTC(2026, 6, 20, 12, 0, 0)
  const IDS = ['zeta', 'yankee', 'xray', 'beta', 'alpha']

  async function plantNativeTie(dir: string, id: string, workspaceScopeId: string): Promise<void> {
    await mkdir(dir, { recursive: true })
    const iso = new Date(SHARED_MS).toISOString()
    const lines = [
      JSON.stringify({
        type: 'session',
        version: 1,
        id,
        timestamp: iso,
        cwd: '/workspace',
        boringSessionCtx: { workspaceId: workspaceScopeId },
      }),
      JSON.stringify({
        type: 'message',
        id: `message-${id}`,
        parentId: null,
        timestamp: iso,
        message: { role: 'user', content: [{ type: 'text', text: `hello ${id}` }], timestamp: 1 },
      }),
    ]
    await writeFile(join(dir, `${iso.replace(/[:.]/g, '-')}_${id}.jsonl`), `${lines.join('\n')}\n`)
  }

  it('pages every equal-timestamp native session exactly once through the gateway', async () => {
    const sessionRoot = await temporaryRoot()
    const workspaceRoot = join(sessionRoot, 'workspace')
    const workspaceScopeId = 'workspace-a:storage-a'
    const scope = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope
    const dir = join(sessionRoot, pathDerivedDirName(workspaceRoot))
    for (const id of IDS) {
      await plantNativeTie(dir, id, workspaceScopeId)
    }

    const host = await startHost({
      agents: [legacyDefaultAgent],
      sessionRoot,
      workspaceRoot,
      sessionNamespace: '',
    })
    try {
      const seen: string[] = []
      let cursor: string | undefined
      let pages = 0
      do {
        const page = await host.gateway.listSessions({ scope, agentTypeId: 'default', limit: 2, cursor })
        pages += 1
        seen.push(...page.sessions.map((summary) => summary.ref.sessionId))
        cursor = page.nextCursor
      } while (cursor && pages < 10)

      expect(seen).toEqual(['alpha', 'beta', 'xray', 'yankee', 'zeta'])
      expect(new Set(seen).size).toBe(IDS.length)
    } finally {
      await host.host.close()
    }
  })

  it('orders tied sessions by id inside the store itself, before any truncation', async () => {
    const { PiSessionStore: Store } = await import('../../harness/pi-coding-agent/sessions')
    const sessionRoot = await temporaryRoot()
    const cwd = join(sessionRoot, 'workspace')
    const dir = join(sessionRoot, pathDerivedDirName(cwd))
    for (const id of IDS) {
      await plantNativeTie(dir, id, 'tie-workspace')
    }
    const store = new Store(cwd, { sessionRoot, storageCwd: cwd })
    const ctx = { workspaceId: 'tie-workspace' }

    // The first page of a bounded listing must already be the total-order
    // prefix; deeper offsets must complete it with zero gaps or repeats.
    const paged: string[] = []
    for (let offset = 0; offset < IDS.length; offset += 2) {
      paged.push(...(await store.list(ctx, { limit: 2, offset })).map((summary) => summary.id))
    }
    expect(paged).toEqual(['alpha', 'beta', 'xray', 'yankee', 'zeta'])
    expect(new Set(paged).size).toBe(IDS.length)
  })

  it('tiebreaks on the FULL header id even when it contains underscores (limit-1)', async () => {
    // SAFE_NATIVE_SESSION_ID allows `_`, but splitting a timestamp-named
    // filename at its LAST underscore truncates 'a_z' to 'z' and 'b_a' to
    // 'a'. A store tiebreak on those truncated keys disagrees with the
    // gateway's total order over full ids, so equal-timestamp sessions can
    // fall outside a bounded prefix and vanish from every page. With limit 1
    // every page is a single row, so any prefix/order disagreement surfaces
    // immediately as a gap, a repeat, or a wrong first row.
    const UNDERSCORE_IDS = ['b_a', 'a_z', 'aa', 'zz_9']
    // localeCompare over full ids: 'a_z' < 'aa' ('_' < 'a'), then 'b_a', 'zz_9'.
    const EXPECTED = ['a_z', 'aa', 'b_a', 'zz_9']

    const sessionRoot = await temporaryRoot()
    const workspaceRoot = join(sessionRoot, 'workspace')
    const workspaceScopeId = 'workspace-u:storage-u'
    const scope = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope
    const dir = join(sessionRoot, pathDerivedDirName(workspaceRoot))
    for (const id of UNDERSCORE_IDS) {
      await plantNativeTie(dir, id, workspaceScopeId)
    }

    const host = await startHost({
      agents: [legacyDefaultAgent],
      sessionRoot,
      workspaceRoot,
      sessionNamespace: '',
    })
    try {
      const seen: string[] = []
      let cursor: string | undefined
      let pages = 0
      do {
        const page = await host.gateway.listSessions({ scope, agentTypeId: 'default', limit: 1, cursor })
        pages += 1
        seen.push(...page.sessions.map((summary) => summary.ref.sessionId))
        cursor = page.nextCursor
        expect(page.sessions.length).toBeLessThanOrEqual(1)
      } while (cursor && pages < 10)

      expect(seen).toEqual(EXPECTED)
    } finally {
      await host.host.close()
    }
  })
})

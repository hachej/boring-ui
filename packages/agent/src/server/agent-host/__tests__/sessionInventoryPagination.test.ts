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
import { AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import type { SessionListOptions } from '../../../shared/session'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
import { writeSessionArchived } from '../../harness/pi-coding-agent/sessionArchiveIndex'
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
      const ref = { agentTypeId: 'default', sessionId: 'pre-existing-session' }
      expect(page.sessions).toEqual([expect.objectContaining({
        ref,
        title: 'A session the user already had',
      })])
      // The host's harnessFactory deliberately throws. Success proves archive
      // mutation shares the storage-only inventory owner used by listing and
      // does not boot a separately composed session repository.
      await expect(host.gateway.setSessionArchived({
        scope,
        ref,
        requestId: 'archive-pre-existing',
        archived: true,
      })).resolves.toMatchObject({ ref, archived: true })
      await expect(host.gateway.listSessions({ scope, archived: 'archived' })).resolves.toMatchObject({
        sessions: [expect.objectContaining({ ref, archived: true })],
      })
    } finally {
      await host.host.close()
    }
  })
})

describe('seat session listing pagination', () => {
  it('pushes archive filtering into each store before cutting its bounded prefix', async () => {
    const sessionRoot = await temporaryRoot()
    const workspaceRoot = join(sessionRoot, 'workspace')
    const workspaceScopeId = 'workspace-filter:storage-filter'
    const scope = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope
    const dir = join(sessionRoot, pathDerivedDirName(workspaceRoot))
    for (let index = 0; index < 8; index += 1) {
      await plant(dir, `session-${index}`, `Session ${index}`, workspaceScopeId, Date.UTC(2026, 6, 20) + index * 60_000)
    }
    // The matching rows are behind six newer opposite-state rows. Gateway-side
    // post-filtering of a limit-2 prefix would return an empty terminal page.
    await writeSessionArchived(dir, 'session-0', true)
    await writeSessionArchived(dir, 'session-1', true)

    const listOptions: SessionListOptions[] = []
    const originalList = PiSessionStore.prototype.list
    vi.spyOn(PiSessionStore.prototype, 'list').mockImplementation(async function (this: PiSessionStore, ctx, options) {
      listOptions.push(options ?? {})
      return await originalList.call(this, ctx, options)
    })

    const host = await startHost({ agents: [legacyDefaultAgent], sessionRoot, workspaceRoot, sessionNamespace: '' })
    try {
      const first = await host.gateway.listSessions({ scope, agentTypeId: 'default', archived: 'archived', limit: 1 })
      expect(first.sessions.map((row) => row.ref.sessionId)).toEqual(['session-1'])
      const second = await host.gateway.listSessions({ scope, agentTypeId: 'default', archived: 'archived', limit: 1, cursor: first.nextCursor })
      expect(second.sessions.map((row) => row.ref.sessionId)).toEqual(['session-0'])
      expect(listOptions.every((options) => options.archived === 'archived')).toBe(true)
    } finally {
      await host.host.close()
    }
  })

  it('binds archive state to pagination cursors', async () => {
    const sessionRoot = await temporaryRoot()
    const workspaceRoot = join(sessionRoot, 'workspace')
    const workspaceScopeId = 'workspace-cursor:storage-cursor'
    const scope = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope
    const dir = join(sessionRoot, pathDerivedDirName(workspaceRoot))
    await plant(dir, 'active-a', 'Active A', workspaceScopeId, Date.UTC(2026, 6, 20))
    await plant(dir, 'active-b', 'Active B', workspaceScopeId, Date.UTC(2026, 6, 21))

    const host = await startHost({ agents: [legacyDefaultAgent], sessionRoot, workspaceRoot, sessionNamespace: '' })
    try {
      const active = await host.gateway.listSessions({ scope, agentTypeId: 'default', archived: 'active', limit: 1 })
      await expect(host.gateway.listSessions({
        scope,
        agentTypeId: 'default',
        archived: 'archived',
        limit: 1,
        cursor: active.nextCursor,
      })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_CURSOR_INVALID })
    } finally {
      await host.host.close()
    }
  })

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

  it('uses one code-unit order for mixed-case and punctuation across store and cursor pages', async () => {
    const ids = ['z', 'a_', 'a-', 'a', 'Z', 'A']
    const expected = ['A', 'Z', 'a', 'a-', 'a_', 'z']
    const sessionRoot = await temporaryRoot()
    const workspaceRoot = join(sessionRoot, 'workspace')
    const workspaceScopeId = 'workspace-case:storage-case'
    const scope = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope
    const dir = join(sessionRoot, pathDerivedDirName(workspaceRoot))
    for (const id of ids) await plantNativeTie(dir, id, workspaceScopeId)

    const store = new PiSessionStore(workspaceRoot, { sessionRoot, storageCwd: workspaceRoot })
    expect((await store.list({ workspaceId: workspaceScopeId })).map((row) => row.id)).toEqual(expected)

    const host = await startHost({ agents: [legacyDefaultAgent], sessionRoot, workspaceRoot, sessionNamespace: '' })
    try {
      const paged: string[] = []
      let cursor: string | undefined
      do {
        const page = await host.gateway.listSessions({ scope, agentTypeId: 'default', limit: 1, cursor })
        paged.push(...page.sessions.map((row) => row.ref.sessionId))
        cursor = page.nextCursor
      } while (cursor)
      expect(paged).toEqual(expected)
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

  it('sorts readable wrapper transcripts by header id, not filename (limit-1)', async () => {
    // A wrapper transcript is not timestamp-named, so its FILENAME stem is
    // free to disagree with the canonical summary id in its readable header.
    // With filenames mapped REVERSE to header ids and limit 1, an ordering
    // keyed on stems leads its bounded prefix with the WRONG row: the
    // gateway emits it, advances the cursor past ids that sort earlier, and
    // every smaller-header-id session vanishes from all later pages.
    const sessionRoot = await temporaryRoot()
    const workspaceRoot = join(sessionRoot, 'workspace')
    const workspaceScopeId = 'workspace-w:storage-w'
    const scope = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope
    const dir = join(sessionRoot, pathDerivedDirName(workspaceRoot))
    await mkdir(dir, { recursive: true })
    const wrappers = [
      { file: 'a.jsonl', headerId: 'wrap-c' },
      { file: 'b.jsonl', headerId: 'wrap-b' },
      { file: 'c.jsonl', headerId: 'wrap-a' },
    ]
    for (const { file, headerId } of wrappers) {
      const iso = new Date(SHARED_MS).toISOString()
      const lines = [
        JSON.stringify({
          type: 'session',
          version: 1,
          id: headerId,
          timestamp: iso,
          cwd: '/workspace',
          boringSessionCtx: { workspaceId: workspaceScopeId },
        }),
        JSON.stringify({
          type: 'message',
          id: `message-${headerId}`,
          parentId: null,
          timestamp: iso,
          message: { role: 'user', content: [{ type: 'text', text: `hello ${headerId}` }], timestamp: 1 },
        }),
      ]
      await writeFile(join(dir, file), `${lines.join('\n')}\n`)
    }
    // Equalize file mtimes so recency ties and the id tiebreak decides —
    // that tiebreak is the whole point of this regression.
    const sharedTime = new Date(SHARED_MS)
    for (const { file } of wrappers) {
      await utimes(join(dir, file), sharedTime, sharedTime)
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

      // Exact gateway total order over header ids. Under filename-stem
      // ordering the store's prefix led with a.jsonl (wrap-c), so wrap-a and
      // wrap-b fell outside the bounded prefix and vanished.
      expect(seen).toEqual(['wrap-a', 'wrap-b', 'wrap-c'])
    } finally {
      await host.host.close()
    }
  })
})

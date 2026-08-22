import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
import { createAgentHost } from '../createAgentHost'
import { AgentSessionActivityIndex, sessionNamespaceForAgent } from '../sessionInventory'
import type { AgentHostAgentSpec } from '../types'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'agent-no-boot-list-'))
  roots.push(value)
  return value
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
    JSON.stringify({
      type: 'session_info',
      id: `info-${id}`,
      parentId: null,
      timestamp,
      name: title,
    }),
    '',
  ].join('\n')
}

describe('no-boot addressed session inventory', () => {
  it('repeatedly lists authoritative existing and legacy transcript metadata without booting a binding', async () => {
    const sessionRoot = await temporaryRoot()
    const agents: readonly AgentHostAgentSpec[] = [
      { agentTypeId: 'default', legacyDefault: true },
      { agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } },
    ]
    const workspaceScopeId = 'workspace-a:storage-a'
    const scope = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope
    const issued = new WeakSet<object>([scope as object])
    const mode = createTestRuntimeModeAdapter('direct')
    const createRuntime = vi.fn(mode.create.bind(mode))
    const harnessFactory = vi.fn(async () => {
      throw new Error('listing must not create a harness')
    })
    const resolveRuntimeScope = vi.fn(async ({ agentTypeId }: { agentTypeId: string }) => ({
      identity: `${agentTypeId}:runtime`,
      environment: {
        placementIdentity: 'direct-a',
        workspaceRoot: sessionRoot,
        provisioningFingerprint: 'provision-a',
      },
      sessionNamespace: agentTypeId === 'default' ? 'legacy-sessions' : 'configured-sessions',
    }))

    const legacyStore = new PiSessionStore(sessionRoot, {
      sessionRoot,
      sessionNamespace: 'legacy-sessions',
    })
    await mkdir(legacyStore.getSessionDir(), { recursive: true })
    await writeFile(
      join(legacyStore.getSessionDir(), 'legacy-existing.jsonl'),
      transcript('legacy-existing', 'Legacy authoritative title', workspaceScopeId, '2026-07-20T00:00:00.000Z'),
    )

    const alpha = agents[1]!
    const alphaStore = new PiSessionStore(sessionRoot, {
      sessionRoot,
      sessionNamespace: sessionNamespaceForAgent(alpha, workspaceScopeId, 'configured-sessions'),
    })
    const alphaSession = await alphaStore.create(
      { workspaceId: workspaceScopeId },
      { title: 'Configured authoritative title' },
    )

    const host = await createAgentHost({
      agents,
      fleetCompiler: { async compile({ agents: input }) { return input } },
      hostId: 'no-boot-list-host',
      scopeVerifier: {
        async verify(candidate) {
          if (!issued.has(candidate as object)) throw new Error('denied')
          return { workspaceScopeId: candidate.workspaceScopeId, authSubjectId: candidate.authSubjectId }
        },
      },
      runtimeModeAdapter: { ...mode, create: createRuntime },
      sessionRoot,
      resolveRuntimeScope,
      harnessFactory,
    })

    try {
      const first = await host.gateway.listSessions({ scope, limit: 10 })
      const second = await host.gateway.listSessions({ scope, limit: 10 })
      const filtered = await host.gateway.listSessions({ scope, agentTypeId: 'alpha', limit: 10 })

      expect(first).toEqual(second)
      expect(first.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ref: { agentTypeId: 'default', sessionId: 'legacy-existing' },
          title: 'Legacy authoritative title',
          status: 'idle',
        }),
        expect.objectContaining({
          ref: { agentTypeId: 'alpha', sessionId: alphaSession.id },
          title: 'Configured authoritative title',
          status: 'idle',
        }),
      ]))
      expect(filtered.sessions.map((summary) => summary.ref)).toEqual([
        { agentTypeId: 'alpha', sessionId: alphaSession.id },
      ])
      expect(createRuntime).not.toHaveBeenCalled()
      expect(harnessFactory).not.toHaveBeenCalled()

      const forged = { workspaceScopeId, authSubjectId: 'subject-a' } as AuthorizedAgentScope
      await expect(host.gateway.listSessions({ scope: forged })).rejects.toMatchObject({
        code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED,
      })
      expect(createRuntime).not.toHaveBeenCalled()
    } finally {
      await host.host.close()
    }
  })
})

describe('process-lifetime session activity index', () => {
  it('derives live activity from events without creating phantom activity on reads', () => {
    const index = new AgentSessionActivityIndex()
    const ref = { agentTypeId: 'alpha', sessionId: 'session-a' }

    expect(index.get('workspace-a', ref)).toBe('idle')
    expect(index.get('workspace-a', ref)).toBe('idle')
    expect(index.get('workspace-b', ref)).toBe('idle')

    index.observe('workspace-a', ref, { type: 'agent-start', seq: 1, turnId: 'turn-a' })
    expect(index.get('workspace-a', ref)).toBe('running')
    expect(index.get('workspace-b', ref)).toBe('idle')

    index.observe('workspace-a', ref, { type: 'agent-end', seq: 2, turnId: 'turn-a', status: 'error' })
    expect(index.get('workspace-a', ref)).toBe('error')

    index.observe('workspace-a', ref, { type: 'agent-end', seq: 3, turnId: 'turn-b', status: 'ok' })
    expect(index.get('workspace-a', ref)).toBe('idle')
  })
})

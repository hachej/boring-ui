import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentGatewayErrorCode, type AgentTool, type AuthorizedAgentScope, type VerifiedAgentScopeClaim } from '../../../shared/index'
import type { AgentHarnessFactory, AgentHarnessFactoryInput } from '../../../shared/harness'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
import { createScriptedPiHarness } from '../../testing/scriptedPiHarness'
import { createAgentHost } from '../createAgentHost'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function temporaryRoot(prefix: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), prefix))
  roots.push(value)
  return value
}

interface CapturedHarness {
  readonly input: AgentHarnessFactoryInput
  readonly renderedPrompt: string
}

function persistedScriptedHarness(captures: CapturedHarness[]): AgentHarnessFactory {
  return async (input) => {
    const dynamic = await input.systemPromptDynamic?.()
    const renderedPrompt = ['HARNESS_BASE', input.systemPromptAppend, dynamic].filter(Boolean).join('\n\n')
    captures.push({ input, renderedPrompt })
    const scripted = createScriptedPiHarness(input)
    return {
      ...scripted,
      sessions: new PiSessionStore(input.cwd, {
        sessionDir: input.sessionDir,
        sessionRoot: input.sessionRoot,
        sessionNamespace: input.sessionNamespace,
        storageCwd: input.cwd,
      }),
      getSystemPrompt: () => renderedPrompt,
    }
  }
}

function actorTool(subject: string, root: string): AgentTool {
  return {
    name: `actor_${subject.replace('-', '_')}`,
    description: 'Acceptance actor/root identity probe',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: `${subject}:${root}` }] }
    },
  }
}

describe('createAgentHost AH0 acceptance integration', () => {
  it('partitions the full workspace/agent/storage/subject matrix while sharing compatible Environments', async () => {
    const sessionRoot = await temporaryRoot('agent-host-acceptance-sessions-')
    const workspaceRoots = new Map<string, string>()
    for (const workspace of ['workspace-a', 'workspace-b']) {
      for (const storage of ['storage-a', 'storage-b']) {
        workspaceRoots.set(`${workspace}:${storage}`, await temporaryRoot(`agent-host-${workspace}-${storage}-`))
      }
    }

    const issued = new WeakSet<object>()
    const issueScope = (workspace: string, storage: string, subject: string) => {
      const scope = {
        workspaceScopeId: `${workspace}:${storage}`,
        authSubjectId: subject,
      } as AuthorizedAgentScope
      issued.add(scope as object)
      return scope
    }
    const captures: CapturedHarness[] = []
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const create = vi.fn(baseAdapter.create.bind(baseAdapter))
    const provision = vi.fn(async ({ runtimeBundle }: { runtimeBundle: Awaited<ReturnType<typeof baseAdapter.create>> }) => {
      await runtimeBundle.workspace.writeFile('shared-generation.txt', 'visible-to-every-compatible-agent')
      return {
        changed: true,
        env: { ACCEPTANCE_GENERATION: 'one' },
        pathEntries: ['/acceptance/bin'],
        skillPaths: ['/acceptance/skill.md'],
      }
    })
    const host = await createAgentHost({
      agents: [
        { agentTypeId: 'alpha', definition: { label: 'Alpha', instructions: 'AUTHORED_ALPHA' } },
        { agentTypeId: 'beta', definition: { label: 'Beta', instructions: 'AUTHORED_BETA' } },
      ],
      fleetCompiler: { async compile({ agents }) { return agents } },
      hostId: 'acceptance-host',
      scopeVerifier: {
        async verify(scope) {
          if (!issued.has(scope as object)) throw new Error('unissued scope')
          return { workspaceScopeId: scope.workspaceScopeId, authSubjectId: scope.authSubjectId }
        },
      },
      runtimeModeAdapter: { ...baseAdapter, create },
      sessionRoot,
      harnessFactory: persistedScriptedHarness(captures),
      async resolveRuntimeScope({ agentTypeId, scope }) {
        const root = workspaceRoots.get(scope.workspaceScopeId)
        if (!root) throw new Error('unknown workspace/storage scope')
        return {
          identity: `${agentTypeId}:${scope.workspaceScopeId}:${scope.authSubjectId}`,
          environment: {
            placementIdentity: `direct:${scope.workspaceScopeId}`,
            workspaceRoot: root,
            provisioningFingerprint: `generation-1:${scope.workspaceScopeId}`,
            provisionRuntime: provision,
          },
          sessionNamespace: 'acceptance',
          extraTools: [actorTool(scope.authSubjectId, root)],
          systemPromptAppend: `HOST_STATIC:${scope.workspaceScopeId}`,
          loadSystemPromptAppend: async () => `DYNAMIC:${scope.authSubjectId}`,
        }
      },
    })

    const created: Array<{ scope: AuthorizedAgentScope; ref: { agentTypeId: string; sessionId: string }; title: string }> = []
    for (const workspace of ['workspace-a', 'workspace-b']) {
      for (const storage of ['storage-a', 'storage-b']) {
        for (const agentTypeId of ['alpha', 'beta']) {
          for (const subject of ['subject-a', 'subject-b']) {
            const scope = issueScope(workspace, storage, subject)
            const title = `${workspace}/${storage}/${agentTypeId}/${subject}`
            const ref = await host.gateway.createSession({
              scope,
              agentTypeId,
              requestId: `create:${title}`,
              title,
            })
            created.push({ scope, ref, title })
            const connection = await host.gateway.connectSession({ scope, ref })
            await connection.send({
              kind: 'prompt',
              requestId: `prompt:${title}`,
              clientNonce: `nonce:${title}`,
              content: title,
            })
            await connection.close()
          }
        }
      }
    }

    expect(create).toHaveBeenCalledTimes(4)
    expect(provision).toHaveBeenCalledTimes(4)
    expect(captures).toHaveLength(16)
    for (const capture of captures) {
      const authored = capture.input.systemPromptAppend?.startsWith('AUTHORED_ALPHA') ? 'AUTHORED_ALPHA' : 'AUTHORED_BETA'
      expect(capture.input.systemPromptAppend).toBe(`${authored}\n\nHOST_STATIC:${capture.input.cwd.includes('workspace-a') ? 'workspace-a' : 'workspace-b'}:${capture.input.cwd.includes('storage-a') ? 'storage-a' : 'storage-b'}`)
      expect(capture.renderedPrompt).toMatch(/^HARNESS_BASE\n\nAUTHORED_(ALPHA|BETA)\n\nHOST_STATIC:workspace-[ab]:storage-[ab]\n\nDYNAMIC:subject-[ab]$/)
      const actorTools = capture.input.tools.filter((tool) => tool.name.startsWith('actor_'))
      expect(actorTools).toHaveLength(1)
      const result = await actorTools[0]!.execute({}, { abortSignal: new AbortController().signal, toolCallId: 'probe' })
      expect(result.content[0]?.text).toContain(capture.input.cwd)
    }

    for (const workspace of ['workspace-a', 'workspace-b']) {
      for (const storage of ['storage-a', 'storage-b']) {
        const observer = issueScope(workspace, storage, 'subject-a')
        const expected = created.filter((row) => row.scope.workspaceScopeId === observer.workspaceScopeId)
        const listed = (await host.gateway.listSessions({ scope: observer })).sessions
        expect(listed.map((row) => row.title).sort()).toEqual(expected.map((row) => row.title).sort())
        expect(listed).toHaveLength(4)
      }
    }

    const foreign = { workspaceScopeId: 'workspace-a:storage-a', authSubjectId: 'subject-a' } as AuthorizedAgentScope
    await expect(host.gateway.createSession({ scope: foreign, agentTypeId: 'alpha', requestId: 'forged' }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED })
    expect(create).toHaveBeenCalledTimes(4)
    await host.host.close()
  }, 30_000)

  it('rejects an incompatible shared identity before provider/provisioning/transcript mutation', async () => {
    const sessionRoot = await temporaryRoot('agent-host-incompatible-sessions-')
    const workspaceRoot = await temporaryRoot('agent-host-incompatible-workspace-')
    const scope = { workspaceScopeId: 'workspace:storage', authSubjectId: 'subject' } as AuthorizedAgentScope
    const issued = new WeakSet<object>([scope as object])
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const create = vi.fn(baseAdapter.create.bind(baseAdapter))
    const provision = vi.fn(async () => ({ changed: false, env: {}, pathEntries: [], skillPaths: [] }))
    const host = await createAgentHost({
      agents: [
        { agentTypeId: 'alpha', definition: { label: 'Alpha', instructions: 'alpha' } },
        { agentTypeId: 'beta', definition: { label: 'Beta', instructions: 'beta' } },
      ],
      fleetCompiler: { async compile({ agents }) { return agents } },
      hostId: 'incompatible-host',
      scopeVerifier: { async verify(value) {
        if (!issued.has(value as object)) throw new Error('denied')
        return value as unknown as VerifiedAgentScopeClaim
      } },
      runtimeModeAdapter: { ...baseAdapter, create },
      sessionRoot,
      harnessFactory: persistedScriptedHarness([]),
      async resolveRuntimeScope({ agentTypeId }) {
        return {
          identity: agentTypeId,
          environment: {
            placementIdentity: 'one-placement',
            workspaceRoot,
            provisioningFingerprint: agentTypeId === 'alpha' ? 'generation-a' : 'generation-b',
            provisionRuntime: provision,
          },
          sessionNamespace: 'acceptance',
        }
      },
    })
    await host.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'alpha' })
    await expect(host.gateway.createSession({ scope, agentTypeId: 'beta', requestId: 'beta' }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SHARED_ENVIRONMENT_UNAVAILABLE })
    expect(create).toHaveBeenCalledOnce()
    expect(provision).toHaveBeenCalledOnce()
    expect((await host.gateway.listSessions({ scope, agentTypeId: 'beta' })).sessions).toEqual([])
    await host.host.close()
  })

  it('keeps the legacy prompt sentinel byte-compatible while configured prompts use exact precedence', async () => {
    const sessionRoot = await temporaryRoot('agent-host-legacy-prompt-')
    const workspaceRoot = await temporaryRoot('agent-host-legacy-prompt-workspace-')
    const scope = { workspaceScopeId: 'workspace', authSubjectId: 'subject' } as AuthorizedAgentScope
    const captures: CapturedHarness[] = []
    const host = await createAgentHost({
      agents: [{ agentTypeId: 'default', legacyDefault: true }],
      fleetCompiler: { async compile({ agents }) { return agents } },
      hostId: 'legacy-prompt-host',
      scopeVerifier: { async verify() { return { workspaceScopeId: 'workspace', authSubjectId: 'subject' } } },
      runtimeModeAdapter: createTestRuntimeModeAdapter('direct'),
      sessionRoot,
      harnessFactory: persistedScriptedHarness(captures),
      async resolveRuntimeScope() {
        return {
          identity: 'legacy',
          environment: { placementIdentity: 'direct', workspaceRoot, provisioningFingerprint: 'one' },
          sessionNamespace: 'legacy',
          systemPromptAppend: 'HOST_STATIC',
          loadSystemPromptAppend: async () => 'DYNAMIC',
        }
      },
    })
    await host.gateway.createSession({ scope, agentTypeId: 'default', requestId: 'create' })
    expect(captures[0]?.input.systemPromptAppend).toBe('HOST_STATIC')
    expect(captures[0]?.renderedPrompt).toBe('HARNESS_BASE\n\nHOST_STATIC\n\nDYNAMIC')
    await host.host.close()
  })
})

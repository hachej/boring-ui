import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { AgentGatewayError, AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import { ErrorCode } from '../../../shared/error-codes'
import type { AgentHarnessFactory } from '../../../shared/harness'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { createScriptedPiHarness } from '../../testing/scriptedPiHarness'
import { InMemorySessionChangesTracker } from '../../http/sessionChangesTracker'
import type { RuntimeFilesystemBinding } from '../../runtime/mode'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import { assertComposedAgentHostRouteTable } from '../testing/compositionRouteProof'
import { createAgentHost } from '../createAgentHost'
import { CREDENTIAL_ERROR_CODES } from '../../../shared/credentials'
import { registerAgentHostEnvironmentRoutes } from '../environmentHttpProjection'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function root() {
  const value = await mkdtemp(join(tmpdir(), 'agent-host-'))
  roots.push(value)
  return value
}

const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' } as AuthorizedAgentScope

function options(sessionRoot: string) {
  return {
    agents: [{ agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } }],
    fleetCompiler: { compile: vi.fn(async ({ agents }: { agents: readonly unknown[] }) => agents as never) },
    scopeVerifier: { verify: vi.fn(async () => ({ workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' })) },
    runtimeModeAdapter: createTestRuntimeModeAdapter('direct'),
    sessionRoot,
    resolveAuthorizedEnvironmentScope: vi.fn(async () => ({
      placementIdentity: 'direct-a',
      workspaceRoot: sessionRoot,
      provisioningFingerprint: 'provision-a',
    })),
    resolveAuthorizedAgentRuntimeScope: vi.fn(async () => ({
      identity: 'runtime-a',
      physicalBindingIdentity: 'runtime-a',
      resourceInputDigest: 'runtime-a',
      sessionNamespace: 'alpha-a',
    })),
  }
}

describe('createAgentHost', () => {
  it('fails at host startup (not first binding) when the credential vault env is misconfigured', async () => {
    // [1082 slice B hardening F1b/F2] the vault composition is resolved once
    // per host, at createAgentHost time; a typo'd KMS backend selection must
    // reject host creation with a stable CREDENTIAL_* code instead of being
    // deferred to (or silently forked across) runtime bindings.
    await expect(createAgentHost({
      ...options(await root()),
      credentials: { env: { BORING_CREDENTIAL_KMS_BACKEND: 'aws-kms' } },
    })).rejects.toMatchObject({
      name: 'CredentialResolutionError',
      code: CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    })
  })

  it('requires durable transactional ledger ownership for the direct projection unless test/dev in-memory mode is explicit', async () => {
    await expect(createAgentHost({
      ...options(await root()),
      requestLedger: new InMemoryAgentRequestLedger(),
    })).rejects.toThrow('transactional durable AgentRequestLedger')

    const ledgerRoot = await root()
    const durableWithoutTranscripts = await createAgentHost({
      ...options(ledgerRoot),
      hostId: 'durable-ledger-without-transcripts',
      sessionRoot: undefined,
      requestLedgerPath: join(ledgerRoot, 'ledger', 'requests.sqlite'),
    })
    await durableWithoutTranscripts.host.close()

    const inMemory = await createAgentHost({
      ...options(await root()),
      inMemoryRequestLedgerMode: 'test',
    })
    expect(() => inMemory.registerDirectRoutes({
      authorizeAgentRequest: async () => scope,
    })).not.toThrow()
    await inMemory.host.close()
  })

  it('awaits compilation, freezes the fleet, and publishes a stable durable identity', async () => {
    const sessionRoot = await root()
    const firstOptions = options(sessionRoot)
    const first = await createAgentHost(firstOptions)
    const firstDescription = await first.host.describe()
    expect(firstOptions.fleetCompiler.compile).toHaveBeenCalledOnce()
    expect(firstDescription).toMatchObject({ agents: [{ agentTypeId: 'alpha', label: 'Alpha' }] })
    expect((await first.gateway.listAgents({ scope }))[0]).toMatchObject({ agentTypeId: 'alpha' })
    expect((await readFile(join(sessionRoot, '.agent-host-id'), 'utf8')).trim()).toBe(first.host.hostId)
    await first.host.close()

    const second = await createAgentHost(options(sessionRoot))
    expect(second.host.hostId).toBe(first.host.hostId)
    await second.host.close()
  })

  it('requires a stable host identity source and validates explicit IDs', async () => {
    const sessionRoot = await root()
    await expect(createAgentHost({ ...options(sessionRoot), hostId: 'bad host' })).rejects.toThrow('hostId')
    await expect(createAgentHost({ ...options(sessionRoot), sessionRoot: undefined })).rejects.toThrow('hostId or a durable sessionRoot')
  })

  it('keeps configured prompt precedence byte-identical across Host restart', async () => {
    const sessionRoot = await root()
    const renderedPrompts: string[] = []
    const harnessFactory: AgentHarnessFactory = async (input) => {
      const dynamic = await input.systemPromptDynamic?.()
      const renderedPrompt = ['HARNESS_BASE', input.systemPromptAppend, dynamic]
        .filter(Boolean)
        .join('\n\n')
      renderedPrompts.push(renderedPrompt)
      return {
        ...createScriptedPiHarness(input),
        getSystemPrompt: () => renderedPrompt,
      }
    }
    const restartOptions = () => ({
      ...options(sessionRoot),
      harnessFactory,
      resolveAuthorizedEnvironmentScope: vi.fn(async () => ({
        placementIdentity: 'direct-prompt',
        workspaceRoot: sessionRoot,
        provisioningFingerprint: 'provision-prompt',
      })),
      resolveAuthorizedAgentRuntimeScope: vi.fn(async () => ({
        identity: 'runtime-prompt',
        physicalBindingIdentity: 'runtime-prompt',
        resourceInputDigest: 'runtime-prompt',
        sessionNamespace: 'alpha-prompt',
        // The Workspace resolver's observed deterministic fragment order is
        // alphabetical by plugin ID: alpha before zeta.
        systemPromptAppend: 'PLUGIN_ALPHA\n\nPLUGIN_ZETA',
        loadSystemPromptAppend: async () => 'HOST_DYNAMIC',
      })),
    })

    const first = await createAgentHost(restartOptions())
    await first.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'first-prompt-session' })
    await first.host.close()

    const second = await createAgentHost(restartOptions())
    await second.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'second-prompt-session' })
    await second.host.close()

    const golden = [
      'HARNESS_BASE',
      'alpha',
      'PLUGIN_ALPHA',
      'PLUGIN_ZETA',
      'HOST_DYNAMIC',
    ].join('\n\n')
    expect(renderedPrompts).toEqual([golden, golden])
    expect(Buffer.from(renderedPrompts[0]!).equals(Buffer.from(renderedPrompts[1]!))).toBe(true)
  })

  it('separates verified Environment and per-Agent resolution and revokes app/dispatcher leases', async () => {
    const workspaceRoot = await root()
    const filesystemOperations = {
      read: vi.fn(async () => ({ content: 'bound' })),
      list: vi.fn(async () => ({ entries: [] })),
      find: vi.fn(async () => ({ paths: [] })),
      grep: vi.fn(async () => ({ matches: [] })),
      stat: vi.fn(async () => ({ isDirectory: false })),
      rejectMutation: vi.fn((): never => { throw new Error('readonly') }),
    }
    const resolveFilesystemBindings = vi.fn(async () => [{
      filesystem: 'request-aware',
      access: 'readonly' as const,
      operations: filesystemOperations,
    }])
    const resolveAuthorizedEnvironmentScope = vi.fn(async ({ authorizedScope, verifiedClaim }: {
      authorizedScope: AuthorizedAgentScope
      verifiedClaim: { workspaceScopeId: string; authSubjectId: string }
    }) => ({
      placementIdentity: 'direct-environment',
      workspaceRoot,
      provisioningFingerprint: 'direct-environment-v1',
      resolveFilesystemBindings,
      issuerScopeWasOriginal: authorizedScope === scope,
      claimSubject: verifiedClaim.authSubjectId,
    }))
    const resolveAuthorizedAgentRuntimeScope = vi.fn(async ({
      authorizedScope,
      verifiedClaim,
      environment,
    }: {
      authorizedScope: AuthorizedAgentScope
      verifiedClaim: { workspaceScopeId: string; authSubjectId: string }
      environment: { placementIdentity: string; workspaceRoot: string; provisioningFingerprint: string }
    }) => ({
      identity: `runtime:${verifiedClaim.authSubjectId}`,
      physicalBindingIdentity: 'runtime:direct-contract',
      resourceInputDigest: 'resources:direct-contract:v1',
      sessionNamespace: 'direct-contract',
      issuerScopeWasOriginal: authorizedScope === scope,
    }))
    const created = await createAgentHost({
      ...options(workspaceRoot),
      inMemoryRequestLedgerMode: 'test',
      resolveAuthorizedEnvironmentScope,
      resolveAuthorizedAgentRuntimeScope,
    })

    const environment = await created.acquireEnvironment({
      authorizedScope: scope,
      intent: { kind: 'http-route', requestId: 'files-1' },
    })
    await environment.workspace.writeFile('direct-contract.txt', 'environment')
    expect(await environment.workspace.readFile('direct-contract.txt')).toBe('environment')
    expect(resolveFilesystemBindings).toHaveBeenCalledWith({
      verifiedClaim: { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' },
      requestId: 'files-1',
    })
    expect(await environment.filesystemBindings![0]!.operations.read({
      filesystem: 'request-aware',
      path: 'direct-contract.txt',
    })).toEqual({ content: 'bound' })
    environment.release()
    expect(() => environment.workspace.readFile('direct-contract.txt')).toThrow(expect.objectContaining({
      code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
    }))
    expect(() => environment.filesystemBindings![0]!.operations.read({
      filesystem: 'request-aware',
      path: 'direct-contract.txt',
    })).toThrow(expect.objectContaining({ code: ErrorCode.enum.AGENT_BINDING_DISPOSED }))

    let retained: import('../types').LeaseBoundWorkspaceAgent | undefined
    await created.runWithWorkspaceAgent({
      authorizedScope: scope,
      agentTypeId: 'alpha',
      context: { workspaceId: 'workspace-a', userId: 'subject-a' },
      requestId: 'dispatcher-1',
    }, async (binding) => {
      retained = binding
      expect(Object.keys(binding).sort()).toEqual([
        'dispatch',
        'interrupt',
        'signal',
        'stop',
        'workspace',
      ])
      await binding.workspace.writeFile('dispatcher.txt', 'scoped')
    })
    expect(() => retained!.workspace.readFile('dispatcher.txt')).toThrow(expect.objectContaining({
      code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
    }))
    expect(resolveAuthorizedEnvironmentScope.mock.calls.every(([input]) => input.authorizedScope === scope)).toBe(true)
    expect(resolveAuthorizedAgentRuntimeScope).toHaveBeenCalledWith(expect.objectContaining({
      authorizedScope: scope,
      verifiedClaim: { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' },
      agentTypeId: 'alpha',
    }))
    await created.host.close()
  })

  it('projects every actor-authorized filesystem to the Environment catalog and only assigned filesystems to each Agent', async () => {
    const workspaceRoot = await root()
    const binding = (filesystem: string, content: string): RuntimeFilesystemBinding => ({
      filesystem,
      access: 'readonly',
      operations: {
        read: vi.fn(async () => ({ content })),
        async list() { return { entries: [] } },
        async find() { return { paths: [] } },
        async grep() { return { matches: [] } },
        async stat() { return { isDirectory: false } },
        rejectMutation() { throw new Error('readonly') },
      },
    })
    const company = binding('company_context', 'company')
    const nutritionist = binding('nutritionist_context', 'nutritionist')
    const legal = binding('legal_context', 'legal')
    const toolsByAgent = new Map<string, Parameters<AgentHarnessFactory>[0]['tools']>()
    const harnessFactory: AgentHarnessFactory = async (input) => {
      toolsByAgent.set(input.systemPromptAppend!, input.tools)
      return createScriptedPiHarness(input)
    }
    const resolveAgentBindings = vi.fn(async (agentTypeId: string) => [
      company,
      agentTypeId === 'nutritionist' ? nutritionist : legal,
    ])
    const created = await createAgentHost({
      ...options(workspaceRoot),
      agents: [
        { agentTypeId: 'nutritionist', definition: { instructions: 'nutritionist', label: 'Nutritionist' } },
        { agentTypeId: 'legal', definition: { instructions: 'legal', label: 'Legal' } },
      ],
      harnessFactory,
      resolveAuthorizedEnvironmentScope: async () => ({
        placementIdentity: 'context-catalog-environment',
        workspaceRoot,
        provisioningFingerprint: 'context-catalog-environment-v1',
        resolveFilesystemBindings: async () => [company, nutritionist, legal],
      }),
      resolveAuthorizedAgentRuntimeScope: async ({ agentTypeId }) => ({
        identity: `context-runtime:${agentTypeId}`,
        physicalBindingIdentity: `context-runtime:${agentTypeId}`,
        resourceInputDigest: `context-resources:${agentTypeId}:v1`,
        sessionNamespace: `context:${agentTypeId}`,
        getFilesystemBindings: async () => await resolveAgentBindings(agentTypeId),
      }),
    })
    const app = Fastify({ logger: false })
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest: async () => scope,
    })

    try {
      const catalog = await app.inject({ method: 'GET', url: '/api/v1/filesystems' })
      expect(catalog.statusCode).toBe(200)
      expect(catalog.json().filesystems.map((entry: { filesystem: string }) => entry.filesystem)).toEqual([
        'user',
        'company_context',
        'nutritionist_context',
        'legal_context',
      ])

      await created.gateway.createSession({
        scope,
        agentTypeId: 'nutritionist',
        requestId: 'nutritionist-context-session',
      })
      await created.gateway.createSession({
        scope,
        agentTypeId: 'legal',
        requestId: 'legal-context-session',
      })
      const toolContext = (requestId: string) => ({
        abortSignal: new AbortController().signal,
        toolCallId: requestId,
        userId: 'subject-a',
        workspaceId: 'workspace-a',
        requestId,
      })
      const nutritionistRead = toolsByAgent.get('nutritionist')!.find((tool) => tool.name === 'read')!
      const legalRead = toolsByAgent.get('legal')!.find((tool) => tool.name === 'read')!

      const ownNutritionist = await nutritionistRead.execute(
        { filesystem: 'nutritionist_context', path: 'knowledge.md' },
        toolContext('nutritionist-own-read'),
      )
      expect(ownNutritionist.isError).not.toBe(true)
      expect(nutritionist.operations.read).toHaveBeenCalledOnce()

      await expect(nutritionistRead.execute(
        { filesystem: 'legal_context', path: 'knowledge.md' },
        toolContext('nutritionist-foreign-read'),
      )).rejects.toThrow('No filesystem binding is available for legal_context')
      expect(legal.operations.read).not.toHaveBeenCalled()

      const ownLegal = await legalRead.execute(
        { filesystem: 'legal_context', path: 'knowledge.md' },
        toolContext('legal-own-read'),
      )
      expect(ownLegal.isError).not.toBe(true)
      expect(legal.operations.read).toHaveBeenCalledOnce()
      expect(resolveAgentBindings.mock.calls.map(([agentTypeId]) => agentTypeId)).toEqual([
        'nutritionist',
        'nutritionist',
        'legal',
      ])
    } finally {
      await app.close()
      await created.host.close()
    }
  })

  it('mounts an agent definition knowledge/ folder as a readonly agent-scoped agent_knowledge binding invisible to sibling agents', async () => {
    const workspaceRoot = await root()
    const knowledgeRoot = await root()
    await writeFile(join(knowledgeRoot, 'facts.md'), 'knowledge facts', 'utf8')
    const toolsByAgent = new Map<string, Parameters<AgentHarnessFactory>[0]['tools']>()
    const harnessFactory: AgentHarnessFactory = async (input) => {
      toolsByAgent.set(input.systemPromptAppend!, input.tools)
      return createScriptedPiHarness(input)
    }
    const created = await createAgentHost({
      ...options(workspaceRoot),
      agents: [
        {
          agentTypeId: 'scholar',
          definition: { instructions: 'scholar', label: 'Scholar', digest: `sha256:${'a'.repeat(64)}` },
          knowledge: { rootDir: knowledgeRoot },
        },
        { agentTypeId: 'plain', definition: { instructions: 'plain', label: 'Plain' } },
      ],
      harnessFactory,
      resolveAuthorizedEnvironmentScope: async () => ({
        placementIdentity: 'knowledge-environment',
        workspaceRoot,
        provisioningFingerprint: 'knowledge-environment-v1',
      }),
      resolveAuthorizedAgentRuntimeScope: async ({ agentTypeId }) => ({
        identity: `knowledge-runtime:${agentTypeId}`,
        physicalBindingIdentity: `knowledge-runtime:${agentTypeId}`,
        resourceInputDigest: `knowledge-resources:${agentTypeId}:v1`,
        sessionNamespace: `knowledge:${agentTypeId}`,
      }),
    })
    const app = Fastify({ logger: false })
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest: async () => scope,
    })

    try {
      // The computed definition digest is surfaced as identity on describe().
      expect((await created.host.describe()).agents).toContainEqual({
        agentTypeId: 'scholar',
        label: 'Scholar',
        definitionDigest: `sha256:${'a'.repeat(64)}`,
      })

      // Knowledge is agent-scoped: it never appears in the shared
      // Environment-level filesystem catalog.
      const catalog = await app.inject({ method: 'GET', url: '/api/v1/filesystems' })
      expect(catalog.statusCode).toBe(200)
      expect(catalog.json().filesystems.map((entry: { filesystem: string }) => entry.filesystem))
        .not.toContain('agent_knowledge')

      await created.gateway.createSession({ scope, agentTypeId: 'scholar', requestId: 'scholar-knowledge-session' })
      await created.gateway.createSession({ scope, agentTypeId: 'plain', requestId: 'plain-knowledge-session' })
      const toolContext = (requestId: string) => ({
        abortSignal: new AbortController().signal,
        toolCallId: requestId,
        userId: 'subject-a',
        workspaceId: 'workspace-a',
        requestId,
      })

      const scholarRead = toolsByAgent.get('scholar')!.find((tool) => tool.name === 'read')!
      const ownRead = await scholarRead.execute(
        { filesystem: 'agent_knowledge', path: 'facts.md' },
        toolContext('scholar-knowledge-read'),
      )
      expect(ownRead.isError).not.toBe(true)
      expect(JSON.stringify(ownRead)).toContain('knowledge facts')

      // Readonly no-leak conformance: mutations are rejected and bytes stay intact.
      const scholarWrite = toolsByAgent.get('scholar')!.find((tool) => tool.name === 'write')
      if (scholarWrite) {
        await expect(scholarWrite.execute(
          { filesystem: 'agent_knowledge', path: 'facts.md', content: 'overwritten' },
          toolContext('scholar-knowledge-write'),
        )).rejects.toThrow()
      }
      expect(await readFile(join(knowledgeRoot, 'facts.md'), 'utf8')).toBe('knowledge facts')

      // Sibling agents never see another definition's knowledge.
      const plainRead = toolsByAgent.get('plain')!.find((tool) => tool.name === 'read')!
      await expect(plainRead.execute(
        { filesystem: 'agent_knowledge', path: 'facts.md' },
        toolContext('plain-knowledge-read'),
      )).rejects.toThrow('No filesystem binding is available for agent_knowledge')
    } finally {
      await app.close()
      await created.host.close()
    }
  })

  it('waits for fire-and-forget callback lease operations before revocation and release', async () => {
    const workspaceRoot = await root()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    let releaseWrite!: () => void
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    let writeCompleted = false
    let watchListener: ((event: { type: 'create'; path: string }) => void) | undefined
    const unsubscribeWatch = vi.fn()
    let observedWatchEvents = 0
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve })
    const created = await createAgentHost({
      ...options(workspaceRoot),
      runtimeModeAdapter: {
        ...baseAdapter,
        async create(context) {
          const bundle = await baseAdapter.create(context)
          const workspace = new Proxy(bundle.workspace, {
            get(target, property, receiver) {
              if (property === 'watch') {
                return () => ({
                  subscribe(listener: (event: { type: 'create'; path: string }) => void) {
                    watchListener = listener
                    return unsubscribeWatch
                  },
                  async whenReady() {
                    await writeGate
                    return { ok: true as const }
                  },
                  close: vi.fn(),
                })
              }
              if (property !== 'writeFile') return Reflect.get(target, property, receiver)
              return async (...args: Parameters<typeof target.writeFile>) => {
                markWriteStarted()
                await writeGate
                const result = await target.writeFile(...args)
                writeCompleted = true
                return result
              }
            },
          })
          return { ...bundle, workspace }
        },
      },
      resolveAuthorizedEnvironmentScope: async () => ({
        placementIdentity: 'lease-operation-environment',
        workspaceRoot,
        provisioningFingerprint: 'lease-operation-environment-v1',
      }),
      resolveAuthorizedAgentRuntimeScope: async () => ({
        identity: 'lease-operation-runtime',
        physicalBindingIdentity: 'lease-operation-binding',
        resourceInputDigest: 'lease-operation-resources-v1',
        sessionNamespace: 'lease-operation',
      }),
    })

    let retained: import('../types').LeaseBoundWorkspaceAgent | undefined
    let finished = false
    const run = created.runWithWorkspaceAgent({
      authorizedScope: scope,
      agentTypeId: 'alpha',
      context: { workspaceId: 'workspace-a', userId: 'subject-a' },
      requestId: 'fire-and-forget',
    }, async (binding) => {
      retained = binding
      const watcher = binding.workspace.watch?.()
      watcher?.subscribe(() => { observedWatchEvents += 1 })
      void watcher?.whenReady?.()
      void binding.workspace.writeFile('delayed.txt', 'complete-before-release')
    }).then(() => { finished = true })
    await writeStarted
    expect(finished).toBe(false)
    await vi.waitFor(() => expect(unsubscribeWatch).toHaveBeenCalledOnce())
    watchListener?.({ type: 'create', path: 'after-callback.txt' })
    expect(observedWatchEvents).toBe(0)
    expect(() => retained!.workspace.readFile('late.txt')).toThrow(expect.objectContaining({
      code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
    }))
    releaseWrite()
    await run
    expect(writeCompleted).toBe(true)
    await created.host.close()
  })

  it('force-revokes a never-settling callback operation at shutdown grace and publishes no late continuation', async () => {
    const workspaceRoot = await root()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    let releaseWrite!: () => void
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve })
    let callbackContinued = false
    let retained: import('../types').LeaseBoundWorkspaceAgent | undefined
    const created = await createAgentHost({
      ...options(workspaceRoot),
      shutdownGraceMs: 10,
      runtimeModeAdapter: {
        ...baseAdapter,
        async create(context) {
          const bundle = await baseAdapter.create(context)
          const workspace = new Proxy(bundle.workspace, {
            get(target, property, receiver) {
              if (property !== 'writeFile') return Reflect.get(target, property, receiver)
              return async () => {
                markWriteStarted()
                await writeGate
              }
            },
          })
          return { ...bundle, workspace }
        },
      },
      resolveAuthorizedEnvironmentScope: async () => ({
        placementIdentity: 'revoked-operation-environment',
        workspaceRoot,
        provisioningFingerprint: 'revoked-operation-environment-v1',
      }),
      resolveAuthorizedAgentRuntimeScope: async () => ({
        identity: 'revoked-operation-runtime',
        physicalBindingIdentity: 'revoked-operation-binding',
        resourceInputDigest: 'revoked-operation-resources-v1',
        sessionNamespace: 'revoked-operation',
      }),
    })

    const run = created.runWithWorkspaceAgent({
      authorizedScope: scope,
      agentTypeId: 'alpha',
      context: { workspaceId: 'workspace-a', userId: 'subject-a' },
      requestId: 'never-settling-operation',
    }, async (binding) => {
      retained = binding
      await binding.workspace.writeFile('never.txt', 'never')
      callbackContinued = true
    })
    run.catch(() => {})
    await writeStarted
    const before = Date.now()
    await created.host.close()
    expect(Date.now() - before).toBeLessThan(250)
    await expect(run).rejects.toMatchObject({ code: ErrorCode.enum.AGENT_BINDING_DISPOSED })
    expect(() => retained!.workspace.readFile('late.txt')).toThrow(expect.objectContaining({
      code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
    }))
    releaseWrite()
    await Promise.resolve()
    await Promise.resolve()
    expect(callbackContinued).toBe(false)
  })

  it('force-revokes a callback stuck outside a tracked provider operation', async () => {
    const workspaceRoot = await root()
    const created = await createAgentHost({
      ...options(workspaceRoot),
      shutdownGraceMs: 10,
    })
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const run = created.runWithWorkspaceAgent({
      authorizedScope: scope,
      agentTypeId: 'alpha',
      context: { workspaceId: 'workspace-a', userId: 'subject-a' },
      requestId: 'stuck-callback',
    }, async () => {
      markStarted()
      await new Promise<never>(() => {})
    })
    run.catch(() => {})
    await started
    await created.host.close()
    await expect(run).rejects.toMatchObject({ code: ErrorCode.enum.AGENT_BINDING_DISPOSED })
  })

  it('Final composed route/auth proof: direct Host mounts the exact table once behind authorization', async () => {
    const workspaceRoot = await root()
    let markSlowStarted!: () => void
    let releaseSlow!: () => void
    const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve })
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve })
    const executeSlashCommand = vi.fn(async (_sessionId: string, name: string) => {
      if (name === 'slow') {
        markSlowStarted()
        await slowGate
      }
    })
    const reloadSession = vi.fn(async () => true)
    let meteringEnabled = false
    let activeRuntimeIdentity = 'direct-route-runtime-v1'
    let activePhysicalBindingIdentity = 'direct-route-binding-v1'
    let reloadCandidateIdentity = 'direct-route-runtime-v1'
    let reloadPhysicalBindingIdentity = 'direct-route-binding-v1'
    let reloadResourceInputDigest = 'resources:direct-route:v1'
    let resourceInputsValid = true
    let invalidateDuringClassification = false
    let invalidateDuringApply = false
    const revalidateResourceInputs = vi.fn(async () => {
      if (invalidateDuringClassification) {
        invalidateDuringClassification = false
        resourceInputsValid = false
      }
      if (!resourceInputsValid) {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT, 'resource inputs changed')
      }
    })
    const applyReload = vi.fn(async () => {
      if (invalidateDuringApply) resourceInputsValid = false
      return undefined
    })
    const harnessFactory = vi.fn(async (input: Parameters<AgentHarnessFactory>[0]) => ({
      ...createScriptedPiHarness(input),
      executeSlashCommand,
      reloadSession,
      getSlashCommands: async () => [{ name: 'check', description: 'Check', source: 'extension' as const }],
    }))
    const created = await createAgentHost({
      ...options(workspaceRoot),
      inMemoryRequestLedgerMode: 'test',
      metering: {
        isEnabled: () => meteringEnabled,
        reserveRun: vi.fn(),
        recordUsage: vi.fn(),
        settleRun: vi.fn(),
        releaseRun: vi.fn(),
      },
      effectAdmission: {
        async admit({ key }) {
          if (key.requestId === 'reload-mutated-during-admission') resourceInputsValid = false
          return { type: 'accepted' as const, admissionReceipt: `accepted:${key.requestId}` }
        },
      },
      harnessFactory,
      resolveAuthorizedEnvironmentScope: async () => ({
        placementIdentity: 'direct-route-environment',
        workspaceRoot,
        provisioningFingerprint: 'direct-route-environment-v1',
      }),
      resolveAuthorizedAgentRuntimeScope: async ({ environment, intent }) => ({
        identity: intent.operation === 'reload'
          ? reloadCandidateIdentity
          : activeRuntimeIdentity,
        physicalBindingIdentity: intent.operation === 'reload'
          ? reloadPhysicalBindingIdentity
          : activePhysicalBindingIdentity,
        resourceInputDigest: reloadResourceInputDigest,
        sessionNamespace: 'direct-routes',
        ...(intent.operation === 'reload' ? { applyReload, revalidateResourceInputs } : {}),
      }),
    })
    const app = Fastify({ logger: false })
    const sessionChangesTracker = new InMemorySessionChangesTracker()
    const mountedRoutes: string[] = []
    app.addHook('onRoute', (route) => {
      for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
        mountedRoutes.push(`${method} ${route.url}`)
      }
    })
    const direct = () => created.registerDirectRoutes({
      defaultSessionId: 'default',
      authorizeAgentRequest: async () => scope,
      sessionChangesTracker,
    })
    await app.register(direct())
    await app.ready()
    assertComposedAgentHostRouteTable(app)
    const matrix = JSON.parse(await readFile(new URL(
      '../../../../../../docs/issues/1029/route-consumer-matrix.json',
      import.meta.url,
    ), 'utf8')) as {
      routes: Array<{ owner: string; final: string[] | null }>
    }
    const expectedHostRoutes = matrix.routes
      .filter((row) => row.owner === 'agent-host')
      .flatMap((row) => row.final ?? [])
    const mountedHostRoutes = mountedRoutes
      .filter((route) => !route.startsWith('HEAD ') && route.includes(' /api/v1/agents'))
      .sort()
    expect(mountedHostRoutes).toEqual([...expectedHostRoutes].sort())
    for (const route of expectedHostRoutes) {
      expect(mountedRoutes.filter((mounted) => mounted === route), route).toHaveLength(1)
    }
    const deniedHost = await createAgentHost({
      ...options(await root()),
      hostId: 'denied-direct-proof-host',
    })
    const deniedApp = Fastify({ logger: false })
    await deniedApp.register(deniedHost.registerDirectRoutes({
      authorizeAgentRequest: async () => {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'denied by composition proof')
      },
    }))
    expect((await deniedApp.inject({ method: 'GET', url: '/api/v1/agents' })).statusCode).toBe(403)
    await deniedApp.close()

    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions',
      payload: { requestId: 'create-direct' },
    })
    const sessionId = session.json<{ sessionId: string }>().sessionId
    sessionChangesTracker.record({
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'alpha',
      sessionId,
    }, {
      op: 'write',
      path: 'scoped-change.ts',
      timestamp: '2026-07-31T00:00:00.000Z',
    })
    expect((await app.inject({
      method: 'GET',
      url: `/api/v1/agents/alpha/sessions/${sessionId}/changes`,
    })).json()).toEqual({ files: [expect.objectContaining({ path: 'scoped-change.ts' })] })
    for (const url of [
      '/api/v1/agents/alpha/sessions/missing/system-prompt',
      '/api/v1/agents/alpha/sessions/missing/changes',
    ]) {
      const missing = await app.inject({ method: 'GET', url })
      expect(missing.statusCode, url).toBe(404)
      expect(missing.json(), url).toMatchObject({ error: { code: AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND } })
    }
    const commandPayload = {
      requestId: 'command-direct',
      sessionId,
      name: 'check',
      args: '--safe',
    }
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/commands/execute',
      payload: commandPayload,
    })).json()).toEqual({ ok: true, sessionId, name: 'check' })
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/commands/execute',
      payload: commandPayload,
    })).json()).toEqual({ ok: true, sessionId, name: 'check' })
    expect(executeSlashCommand).toHaveBeenCalledOnce()
    const meteredPayload = {
      requestId: 'command-metered',
      sessionId,
      name: 'check',
      args: '--metered',
    }
    meteringEnabled = true
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/commands/execute',
      payload: meteredPayload,
    })).json()).toMatchObject({ error: { code: ErrorCode.enum.METERING_UNSUPPORTED_COMMAND } })
    meteringEnabled = false
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/commands/execute',
      payload: meteredPayload,
    })).json()).toEqual({ ok: true, sessionId, name: 'check' })
    expect(executeSlashCommand).toHaveBeenCalledTimes(2)
    const slowPayload = {
      requestId: 'command-slow',
      sessionId,
      name: 'slow',
      args: '',
    }
    const slow = app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/commands/execute',
      payload: slowPayload,
    })
    await slowStarted
    const inProgress = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/commands/execute',
      payload: slowPayload,
    })
    expect(inProgress.statusCode).toBe(409)
    expect(inProgress.json()).toMatchObject({
      error: { code: AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS },
    })
    const fencedReload = app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-waits-for-command', sessionId },
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(reloadSession).not.toHaveBeenCalled()
    releaseSlow()
    expect((await slow).statusCode).toBe(200)
    expect((await fencedReload).statusCode).toBe(200)
    expect(reloadSession).toHaveBeenCalledOnce()
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/commands/execute',
      payload: slowPayload,
    })).json()).toEqual({ ok: true, sessionId, name: 'slow' })
    expect(executeSlashCommand).toHaveBeenCalledTimes(3)
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-direct', sessionId },
    })).json()).toEqual({ ok: true, sessionId, reloaded: true })
    expect(reloadSession).toHaveBeenCalledTimes(2)
    expect(applyReload).toHaveBeenCalledTimes(2)

    invalidateDuringClassification = true
    const classificationMutation = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-mutated-during-classification', sessionId },
    })
    expect(classificationMutation.statusCode).toBe(409)
    expect(classificationMutation.json()).toMatchObject({
      error: { code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT },
    })
    expect(applyReload).toHaveBeenCalledTimes(2)

    resourceInputsValid = true
    const admissionMutation = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-mutated-during-admission', sessionId },
    })
    expect(admissionMutation.statusCode).toBe(409)
    expect(admissionMutation.json()).toMatchObject({
      error: { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN },
    })
    expect(applyReload).toHaveBeenCalledTimes(2)
    resourceInputsValid = true

    invalidateDuringApply = true
    const applyMutation = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-mutated-during-apply', sessionId },
    })
    expect(applyMutation.statusCode).toBe(409)
    expect(applyMutation.json()).toMatchObject({
      error: { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN },
    })
    expect(applyReload).toHaveBeenCalledTimes(3)
    expect(reloadSession).toHaveBeenCalledTimes(2)
    invalidateDuringApply = false
    resourceInputsValid = true

    reloadResourceInputDigest = 'resources:direct-route:v2'
    const changedResources = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-direct', sessionId },
    })
    expect(changedResources.statusCode).toBe(409)
    expect(changedResources.json()).toMatchObject({
      error: { code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT },
    })
    expect(reloadSession).toHaveBeenCalledTimes(2)
    expect(applyReload).toHaveBeenCalledTimes(3)
    reloadResourceInputDigest = 'resources:direct-route:v1'
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-direct', sessionId },
    })).json()).toEqual({ ok: true, sessionId, reloaded: true })
    expect(reloadSession).toHaveBeenCalledTimes(2)
    expect(applyReload).toHaveBeenCalledTimes(3)
    const missingReloadPayload = { requestId: 'reload-missing-session', sessionId: 'missing-reload-session' }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const missingReload = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/alpha/reload',
        payload: missingReloadPayload,
      })
      expect(missingReload.statusCode).toBe(404)
      expect(missingReload.json()).toMatchObject({
        error: { code: AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND },
      })
    }
    expect(reloadSession).toHaveBeenCalledTimes(2)
    expect(applyReload).toHaveBeenCalledTimes(3)
    reloadCandidateIdentity = 'direct-route-runtime-v2'
    const restartRequired = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-restart-required', sessionId },
    })
    expect(restartRequired.statusCode).toBe(409)
    expect(restartRequired.json()).toMatchObject({
      error: {
        code: AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED,
        details: {
          currentIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
          candidateIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
          currentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          candidateFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    })
    expect(reloadSession).toHaveBeenCalledTimes(2)
    expect(applyReload).toHaveBeenCalledTimes(3)

    // A candidate identity observed by another sessionless capability route
    // must neither replace nor bypass the Host generation's current binding.
    activeRuntimeIdentity = 'direct-route-runtime-v2'
    const bindingCountBeforeCandidate = harnessFactory.mock.calls.length
    expect((await app.inject({
      method: 'GET',
      url: '/api/v1/agents/alpha/tools',
    })).statusCode).toBe(200)
    expect(harnessFactory).toHaveBeenCalledTimes(bindingCountBeforeCandidate)
    const candidateWasPublished = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-sessionless-published-candidate' },
    })
    expect(candidateWasPublished.statusCode).toBe(409)
    expect(candidateWasPublished.json()).toMatchObject({
      error: { code: AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED },
    })
    expect(reloadSession).toHaveBeenCalledTimes(2)
    expect(applyReload).toHaveBeenCalledTimes(3)

    activeRuntimeIdentity = 'direct-route-runtime-v1'
    reloadCandidateIdentity = 'direct-route-runtime-v1'
    reloadPhysicalBindingIdentity = 'direct-route-binding-v2'
    const changedPhysicalBinding = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/reload',
      payload: { requestId: 'reload-sessionless-physical-change' },
    })
    expect(changedPhysicalBinding.statusCode).toBe(409)
    expect(changedPhysicalBinding.json()).toMatchObject({
      error: { code: AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED },
    })
    expect(reloadSession).toHaveBeenCalledTimes(2)
    expect(applyReload).toHaveBeenCalledTimes(3)
    await app.close()

    const duplicateHost = await createAgentHost({
      ...options(await root()),
      hostId: 'duplicate-projection-host',
    })
    const duplicateApp = Fastify({ logger: false })
    const projection = duplicateHost.registerDirectRoutes({
      authorizeAgentRequest: async () => scope,
    })
    await duplicateApp.register(projection)
    await expect(duplicateApp.register(projection)).rejects.toMatchObject({ code: ErrorCode.enum.CONFIG_INVALID })
    await duplicateApp.close()
  })

  it('durably replays insufficient-credit rejection instead of reporting an unknown outcome', async () => {
    const workspaceRoot = await root()
    const reserveRun = vi.fn(async () => {
      throw Object.assign(new Error('insufficient credits'), {
        code: ErrorCode.enum.PAYMENT_REQUIRED,
        statusCode: 402,
      })
    })
    const created = await createAgentHost({
      ...options(workspaceRoot),
      // Metering rejects this request before harness execution. Keep the test on
      // that causal seam instead of paying unrelated real-provider discovery.
      harnessFactory: createScriptedPiHarness,
      metering: {
        isEnabled: () => true,
        reserveRun,
        recordUsage: vi.fn(async () => ({ billedMicros: 0 })),
        settleRun: vi.fn(async () => {}),
        releaseRun: vi.fn(async () => {}),
      },
    })
    const app = Fastify({ logger: false })
    await app.register(created.registerDirectRoutes({ authorizeAgentRequest: async () => scope }))
    const createdSession = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions',
      payload: { requestId: 'create-credit-session' },
    })
    const sessionId = createdSession.json<{ sessionId: string }>().sessionId
    const prompt = {
      method: 'POST' as const,
      url: `/api/v1/agents/alpha/sessions/${sessionId}/prompt`,
      payload: {
        requestId: 'insufficient-credit-prompt',
        clientNonce: 'insufficient-credit-nonce',
        content: 'hello',
      },
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject(prompt)
      expect(response.statusCode).toBe(402)
      expect(response.json()).toEqual({
        error: { code: ErrorCode.enum.PAYMENT_REQUIRED, message: 'insufficient credits' },
      })
    }
    expect(reserveRun).toHaveBeenCalledOnce()
    await app.close()
  })

  it('preserves safe pre-mutation service errors and canonicalizes post-begin failures on first response and replay', async () => {
    const workspaceRoot = await root()
    const stable = Object.assign(new Error('session catalog is locked'), {
      code: ErrorCode.enum.SESSION_LOCKED,
      statusCode: 423,
      retryable: true,
    })
    const created = await createAgentHost({
      ...options(workspaceRoot),
      inMemoryRequestLedgerMode: 'test',
      harnessFactory: async (input) => {
        const harness = createScriptedPiHarness(input)
        return {
          ...harness,
          sessions: {
            ...harness.sessions,
            async create() { throw new Error('provider disconnected after create began') },
          },
          async getSlashCommands() { throw stable },
        }
      },
    })
    const app = Fastify({ logger: false })
    await app.register(created.registerDirectRoutes({ authorizeAgentRequest: async () => scope }))

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const known = await app.inject({ method: 'GET', url: '/api/v1/agents/alpha/commands' })
      expect(known.statusCode).toBe(423)
      expect(known.json()).toEqual({
        error: { code: ErrorCode.enum.SESSION_LOCKED, message: 'session catalog is locked', retryable: true },
      })
    }

    const createRequest = {
      method: 'POST' as const,
      url: '/api/v1/agents/alpha/sessions',
      payload: { requestId: 'ambiguous-create' },
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ambiguous = await app.inject(createRequest)
      expect(ambiguous.statusCode).toBe(409)
      expect(ambiguous.json()).toEqual({
        error: {
          code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
          message: 'effect outcome could not be safely replayed',
        },
      })
    }
    await app.close()
  })
})

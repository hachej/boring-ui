import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import { ErrorCode } from '../../../shared/error-codes'
import type { AgentTool, ToolExecContext } from '../../../shared/tool'
import type { Sandbox, Workspace } from '../../../shared/index'
import {
  SANDBOX_LEASE_ERROR_CODES,
  type SandboxLeaseService,
} from '../../sandbox/leases/sandboxLease'
import { addSandboxTargeting, assertSandboxToolCatalogAuthority } from '../sandboxTargeting'

const encoder = new TextEncoder()
const ENOENT_CODE = 'ENOENT'
const ISOLATED_SOURCE = '1'
const ctx = {
  abortSignal: new AbortController().signal,
  toolCallId: 'target-call',
  sessionId: 'session-a',
  workspaceId: 'workspace-a',
} as ToolExecContext

function primary(name: string): AgentTool {
  return {
    name,
    description: `primary ${name}`,
    readinessRequirements: ['sandbox-exec'],
    parameters: { type: 'object', properties: {}, additionalProperties: true },
    execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: `primary:${name}` }] })),
  }
}

function pair() {
  const files = new Map<string, string | Uint8Array>([['a.txt', 'before needle']])
  const workspace = {
    root: '/workspace',
    runtimeContext: { runtimeCwd: '/workspace' },
    async readFile(path: string) {
      const value = files.get(path)
      if (typeof value !== 'string') throw Object.assign(new Error('not found'), { code: ENOENT_CODE })
      return value
    },
    async writeFile(path: string, content: string) { files.set(path, content) },
    async readBinaryFile(path: string) {
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error('not found'), { code: ENOENT_CODE })
      return typeof value === 'string' ? encoder.encode(value) : value
    },
    async writeBinaryFile(path: string, content: Uint8Array) { files.set(path, content) },
    async mkdir() {},
    async stat(path: string) {
      if (path === '.' || path === '' || path === 'assets' || path === 'assets/images') return { size: 0, mtimeMs: 1, kind: 'dir' as const }
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error('not found'), { code: ENOENT_CODE })
      return { size: typeof value === 'string' ? value.length : value.byteLength, mtimeMs: 1, kind: 'file' as const }
    },
    async readdir() { return [...files.keys()].map((name) => ({ name, kind: 'file' as const })) },
    async unlink(path: string) { files.delete(path) },
    async rename(from: string, to: string) { const value = files.get(from)!; files.delete(from); files.set(to, value) },
  } as Workspace
  const exec = vi.fn(async (command: string) => {
    const stdout = command.startsWith('rg ')
      ? `${JSON.stringify({ type: 'match', data: { path: { text: 'a.txt' }, line_number: 1, lines: { text: 'before needle\n' } } })}\n`
      : command.includes("'fd'")
        ? '/workspace/a.txt\n'
        : `remote:${command}`
    return {
      stdout: encoder.encode(stdout),
      stderr: new Uint8Array(),
      exitCode: 0,
      durationMs: 1,
      truncated: false,
      stdoutEncoding: 'utf-8' as const,
      stderrEncoding: 'utf-8' as const,
    }
  })
  const sandbox = {
    id: 'remote',
    placement: 'remote',
    provider: 'vercel-sandbox',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace' },
    exec,
  } as Sandbox
  return { pair: { workspace, sandbox, dispose: async () => {} } as WorkspaceSandboxPairV1, files, exec }
}

function fixture() {
  const target = pair()
  const withPair = vi.fn(async (_owner: string, _lease: string, action: (pair: WorkspaceSandboxPairV1) => Promise<unknown>) => await action(target.pair))
  const leases = { withPair } as unknown as SandboxLeaseService
  const primaries = ['bash', 'read', 'write', 'edit', 'find', 'grep', 'ls', 'upload_file', 'execute_isolated_code']
    .map(primary)
  const tools = addSandboxTargeting(primaries, {
    leases,
    workspaceScopeId: 'workspace-a',
    agentTypeId: 'worker',
    includeFilesystemTools: true,
    includeUploadTools: true,
  })
  const tool = (name: string) => tools.find((entry) => entry.name === name)!
  return { tool, target, primaries, withPair }
}

describe('native sandbox targeting', () => {
  it('reserves every canonical target name only when the capability is composed', () => {
    for (const name of ['sandbox', 'bash', 'read', 'write', 'edit', 'find', 'grep', 'ls', 'upload_file']) {
      expect(() => assertSandboxToolCatalogAuthority({
        sandboxTools: {}, extraTools: [primary(name)], includeUploadTools: true,
      })).toThrow(`reserves tool name: ${name}`)
    }
    expect(() => assertSandboxToolCatalogAuthority({
      sandboxTools: {}, extraTools: [primary('upload_file')], includeUploadTools: false,
    })).not.toThrow()
    expect(() => assertSandboxToolCatalogAuthority({
      sandboxTools: {}, extraTools: [primary('custom')], includeUploadTools: true,
    })).not.toThrow()
    expect(() => assertSandboxToolCatalogAuthority({
      extraTools: [primary('sandbox')], includeUploadTools: true,
    })).not.toThrow()
  })

  it('preserves the primary delegate when sandbox is omitted and excludes isolated-code', async () => {
    const { tool, primaries, withPair } = fixture()
    await expect(tool('bash').execute({ command: 'pwd' }, ctx)).resolves.toMatchObject({
      content: [{ text: 'primary:bash' }],
    })
    await expect(tool('execute_isolated_code').execute({ code: ISOLATED_SOURCE, language: 'python', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ content: [{ text: 'primary:execute_isolated_code' }] })
    const primaryBash = primaries.find((entry) => entry.name === 'bash')!
    expect(primaryBash.execute).toHaveBeenCalledWith({ command: 'pwd' }, ctx)
    expect(tool('bash').readinessRequirements).toBe(primaryBash.readinessRequirements)
    expect((tool('bash').parameters.properties as Record<string, unknown>).sandbox)
      .toMatchObject({ type: 'string' })
    expect(withPair).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', { ...ctx, workspaceId: undefined }],
    ['mismatched', { ...ctx, workspaceId: 'workspace-b' }],
  ])('rejects %s workspace identity before pinning a target', async (_label, invalidCtx) => {
    const { tool, withPair } = fixture()
    await expect(tool('bash').execute({ command: 'pwd', sandbox: 'lease-handle-0001' }, invalidCtx))
      .resolves.toMatchObject({
        isError: true,
        details: { code: SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, retryable: false },
      })
    expect(withPair).not.toHaveBeenCalled()
  })

  it('routes bash and every canonical file tool through the same pinned pair', async () => {
    const { tool, target, withPair } = fixture()
    await expect(tool('bash').execute({ command: 'printf ok', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ isError: false })
    await expect(tool('read').execute({ path: 'a.txt', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('before needle') }] })
    await tool('write').execute({ path: 'b.txt', content: 'created', sandbox: 'lease-handle-0001' }, ctx)
    await tool('edit').execute({ path: 'a.txt', edits: [{ oldText: 'before', newText: 'after' }], sandbox: 'lease-handle-0001' }, ctx)
    await expect(tool('ls').execute({ path: '.', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('a.txt') }] })
    await expect(tool('find').execute({ pattern: '*.txt', path: '.', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('a.txt') }] })
    await expect(tool('grep').execute({ pattern: 'needle', path: '.', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('a.txt:1') }] })
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    await expect(tool('upload_file').execute({ path: 'a.txt', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ isError: false, details: { path: expect.stringContaining('assets/images/') } })

    expect(target.files.get('a.txt')).toBe('after needle')
    expect(target.files.get('b.txt')).toBe('created')
    expect(target.exec).toHaveBeenCalledWith('printf ok', expect.not.objectContaining({ sandbox: expect.anything() }))
    expect(withPair).toHaveBeenCalledTimes(8)
    const owners = new Set(withPair.mock.calls.map((call) => call[0]))
    expect([...owners]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)])
  })

  it('keeps two sandbox handles isolated and rejects named filesystem routing before pinning', async () => {
    const first = pair()
    const second = pair()
    const withPair = vi.fn(async (_owner: string, lease: string, action: (pair: WorkspaceSandboxPairV1) => Promise<unknown>) =>
      await action(lease === 'lease-handle-0001' ? first.pair : second.pair))
    const tools = addSandboxTargeting([primary('write'), primary('read')], {
      leases: { withPair } as unknown as SandboxLeaseService,
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
      includeFilesystemTools: true,
      includeUploadTools: false,
    })
    const write = tools.find((tool) => tool.name === 'write')!
    const read = tools.find((tool) => tool.name === 'read')!
    await write.execute({ path: 'marker.txt', content: 'one', sandbox: 'lease-handle-0001' }, ctx)
    await write.execute({ path: 'marker.txt', content: 'two', sandbox: 'lease-handle-0002' }, ctx)
    await expect(read.execute({ path: 'marker.txt', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('one') }] })
    await expect(read.execute({ path: 'marker.txt', sandbox: 'lease-handle-0002' }, ctx))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('two') }] })
    await expect(read.execute({ path: 'a.txt', filesystem: 'knowledge', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ isError: true, details: { code: ErrorCode.enum.SANDBOX_TARGET_INVALID } })
    await expect(read.execute({ path: 'a.txt', sandbox: '../escape' }, ctx))
      .resolves.toMatchObject({ isError: true, details: { code: ErrorCode.enum.SANDBOX_TARGET_INVALID } })
    expect(withPair).toHaveBeenCalledTimes(4)
  })
})

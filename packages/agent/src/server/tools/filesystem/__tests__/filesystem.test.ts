import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createReadToolDefinition } from '@mariozechner/pi-coding-agent'
import { describe, expect, test, vi } from 'vitest'

import type { FileSearch } from '../../../../shared/file-search'
import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import type { Workspace } from '../../../../shared/workspace'
import { createLogger } from '../../../logging'
import type { RuntimeBundle, RuntimeFilesystemBindingOperations } from '../../../runtime/mode'
import { buildFilesystemAgentTools } from '../index'

const logger = createLogger('[test:tools:filesystem]')

function logStep(step: string, details: Record<string, unknown> = {}): void {
  logger.info('step', { suite: 'filesystem', step, ...details })
}

function logToolE2e(details: {
  tool: string
  filesystem: string
  path?: string
  pattern?: string
  expectedBinding: string
  resultSummary: string
}): void {
  logger.info('company-fs-tool-e2e', details)
}

function mockWorkspace(root = '/workspace'): Workspace {
  const runtimeContext = { runtimeCwd: root }
  return {
    root: runtimeContext.runtimeCwd,
    runtimeContext,
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    stat: vi.fn(async () => ({ size: 0, mtimeMs: 0, kind: 'file' as const })),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
  }
}

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 1,
    truncated: false,
    stdoutEncoding: 'utf-8',
    stderrEncoding: 'utf-8',
    ...overrides,
  }
}

function mockSandbox(provider: string): Sandbox {
  const runtimeContext = { runtimeCwd: '/workspace' }
  return {
    id: `mock-${provider}`,
    placement: provider === 'vercel-sandbox' ? 'remote' : 'server',
    provider,
    capabilities: ['exec'],
    runtimeContext,
    exec: vi.fn(async () => makeExecResult()),
  }
}

function mockFileSearch(): FileSearch {
  return { search: vi.fn(async () => []) }
}

function mockReadonlyBindingOperations(): RuntimeFilesystemBindingOperations {
  return {
    read: vi.fn(async ({ path }) => ({ content: `company read ${path}`, metadata: { filesystem: 'company_context', path, operation: 'read' } })),
    list: vi.fn(async ({ path }) => ({ entries: [`company list ${path}`], metadata: { filesystem: 'company_context', path, operation: 'list' } })),
    find: vi.fn(async ({ path }, pattern) => ({ paths: [`${path}/${pattern}`], metadata: { filesystem: 'company_context', path, operation: 'find' } })),
    grep: vi.fn(async ({ path }, pattern) => ({ matches: [{ path: `${path}/match.md`, line: 1, text: `company grep ${pattern}` }], metadata: { filesystem: 'company_context', path, operation: 'grep' } })),
    stat: vi.fn(async ({ path }) => ({ isDirectory: path.endsWith('/'), metadata: { filesystem: 'company_context', path, operation: 'stat' } })),
    rejectMutation: vi.fn((operation, descriptor) => {
      throw new Error(`company_context is readonly for ${operation}:${descriptor.path}`)
    }),
  }
}

function mockBundle(provider: string, root = '/workspace', storageRoot?: string): RuntimeBundle {
  const runtimeContext = { runtimeCwd: root }
  return {
    runtimeContext,
    storageRoot: storageRoot ?? (provider === 'vercel-sandbox' ? undefined : root),
    workspace: mockWorkspace(root),
    sandbox: { ...mockSandbox(provider), runtimeContext },
    fileSearch: mockFileSearch(),
    filesystem: provider === 'vercel-sandbox' ? { kind: 'remote-workspace' } : { kind: 'host' },
  }
}

function withFilesystemBinding(
  bundle: RuntimeBundle,
  operations = mockReadonlyBindingOperations(),
  access: 'readonly' | 'readwrite' = 'readonly',
): RuntimeBundle {
  return {
    ...bundle,
    filesystemBindings: [{
      filesystem: 'company_context',
      access,
      operations,
    }],
  }
}

function toolNames(provider: string): string[] {
  return buildFilesystemAgentTools(mockBundle(provider)).map((tool) => tool.name)
}

describe('buildFilesystemAgentTools', () => {
  test('direct mode returns pi filesystem tool names in stable order', () => {
    logStep('direct:names')

    expect(toolNames('direct')).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])
  })

  test('local bwrap mode returns pi filesystem tool names in stable order', () => {
    logStep('bwrap:names')

    expect(toolNames('bwrap')).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])
  })

  test('vercel-sandbox mode returns filesystem tool names with custom grep', async () => {
    logStep('vercel:names-and-custom-grep')

    const bundle = mockBundle('vercel-sandbox')
    const tools = buildFilesystemAgentTools(bundle)

    expect(tools.map((tool) => tool.name)).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])

    const grep = tools.find((tool) => tool.name === 'grep')
    expect(grep).toBeDefined()

    await grep!.execute(
      { pattern: 'needle' },
      { abortSignal: new AbortController().signal, toolCallId: 'grep-1' },
    )

    logStep('vercel:grep-exec-called', {
      calls: vi.mocked(bundle.sandbox.exec).mock.calls.length,
    })
    expect(bundle.sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining('rg '),
      expect.objectContaining({ timeoutMs: 30_000 }),
    )
  })

  test('remote filesystem defaults to workspace operations when a custom remote bundle omits an explicit filesystem strategy', async () => {
    const bundle = mockBundle('custom-remote', '/workspace', undefined)
    bundle.storageRoot = undefined
    bundle.sandbox = { ...bundle.sandbox, placement: 'remote' }
    delete bundle.filesystem
    vi.mocked(bundle.workspace.readFile).mockResolvedValueOnce('implicit remote content')

    const tools = buildFilesystemAgentTools(bundle)
    const read = tools.find((tool) => tool.name === 'read')
    expect(read).toBeDefined()

    const result = await read!.execute(
      { path: 'remote-default.txt' },
      { abortSignal: new AbortController().signal, toolCallId: 'read-custom-remote-default' },
    )

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('implicit remote content')
    expect(bundle.workspace.readFile).toHaveBeenCalledWith('remote-default.txt')
  })

  test('uses runtime-provided remote filesystem tools without a provider-name allowlist', async () => {
    const bundle = mockBundle('custom-remote', '/workspace', undefined)
    bundle.storageRoot = undefined
    bundle.sandbox = { ...bundle.sandbox, placement: 'remote' }
    bundle.filesystem = { kind: 'remote-workspace' }
    vi.mocked(bundle.workspace.readFile).mockResolvedValueOnce('remote content')

    const tools = buildFilesystemAgentTools(bundle)
    const read = tools.find((tool) => tool.name === 'read')
    expect(read).toBeDefined()

    const result = await read!.execute(
      { path: 'remote.txt' },
      { abortSignal: new AbortController().signal, toolCallId: 'read-custom-remote' },
    )

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('remote content')
    expect(bundle.workspace.readFile).toHaveBeenCalledWith('remote.txt')
  })

  test('switching modes returns fresh tool objects', () => {
    logStep('mode-switch:fresh-objects')

    const directTools = buildFilesystemAgentTools(mockBundle('direct'))
    const vercelTools = buildFilesystemAgentTools(mockBundle('vercel-sandbox'))

    expect(directTools).not.toBe(vercelTools)
    expect(directTools.map((tool, index) => tool === vercelTools[index])).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })

  test('local bwrap filesystem tools use host storage root while runtime cwd is /workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'filesystem-tools-local-'))
    try {
      await writeFile(join(workspaceRoot, 'hello.txt'), 'hello from host root', 'utf8')
      const tools = buildFilesystemAgentTools(mockBundle('bwrap', '/workspace', workspaceRoot))
      const read = tools.find((tool) => tool.name === 'read')
      expect(read).toBeDefined()

      const result = await read!.execute(
        { path: 'hello.txt' },
        { abortSignal: new AbortController().signal, toolCallId: 'read-local-host-root' },
      )

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('hello from host root')
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('preserves Pi factory tool identity and does not introduce duplicate company tools', () => {
    const tools = buildFilesystemAgentTools(mockBundle('direct'))
    const names = tools.map((tool) => tool.name)
    const read = tools.find((tool) => tool.name === 'read')

    expect(names).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])
    expect(names).not.toContain('read_company_context')
    expect(names).not.toContain('grep_company_context')
    expect(read?.description).toBe(createReadToolDefinition('/workspace').description)
    expect(read?.promptSnippet).toBe(createReadToolDefinition('/workspace').promptSnippet)
  })

  test('named filesystem prompt and schema guidance are gated on advertised binding', () => {
    const absent = buildFilesystemAgentTools(mockBundle('direct')).find((tool) => tool.name === 'ls')!
    const present = buildFilesystemAgentTools(withFilesystemBinding(mockBundle('direct'))).find((tool) => tool.name === 'ls')!

    expect(JSON.stringify(absent.parameters)).not.toContain('company_context')
    expect(absent.promptSnippet ?? '').not.toContain('company_context')
    expect(JSON.stringify(present.parameters)).toContain('company_context')
    expect(present.promptSnippet).toContain('Named filesystem bindings')
    expect(present.promptSnippet).toContain('company_context')
    expect(present.promptSnippet).toContain('default to the user workspace')
    expect(present.promptSnippet).toContain('A binding may be readonly or readwrite')
    expect(present.promptSnippet).toContain('do not use path prefixes')
  })

  test('filesystem parameter is optional and explicit user behaves like omission', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'filesystem-tools-user-'))
    try {
      await writeFile(join(workspaceRoot, 'hello.txt'), 'hello user fs', 'utf8')
      const tools = buildFilesystemAgentTools(withFilesystemBinding(mockBundle('direct', workspaceRoot)))
      const read = tools.find((tool) => tool.name === 'read')
      expect(read).toBeDefined()
      expect((read!.parameters.properties as Record<string, unknown>).filesystem).toMatchObject({ enum: ['user', 'company_context'] })

      const omitted = await read!.execute(
        { path: 'hello.txt' },
        { abortSignal: new AbortController().signal, toolCallId: 'read-user-omitted' },
      )
      const explicit = await read!.execute(
        { filesystem: 'user', path: 'hello.txt' },
        { abortSignal: new AbortController().signal, toolCallId: 'read-user-explicit' },
      )

      expect(omitted.content[0].text).toContain('hello user fs')
      expect(explicit.content[0].text).toContain('hello user fs')
      logToolE2e({ tool: 'read', filesystem: 'default', path: 'hello.txt', expectedBinding: 'user', resultSummary: 'matches explicit user output' })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('resolves filesystem bindings per tool execution context', async () => {
    const bundle = mockBundle('direct')
    const alphaOps = mockReadonlyBindingOperations()
    const betaOps = mockReadonlyBindingOperations()
    vi.mocked(alphaOps.read).mockResolvedValue({ content: 'alpha-context', metadata: { user: 'alpha' } })
    vi.mocked(betaOps.read).mockResolvedValue({ content: 'beta-context', metadata: { user: 'beta' } })

    const tools = buildFilesystemAgentTools(bundle, {
      getFilesystemBindings: (ctx) => [{
        filesystem: 'company_context',
        access: 'readonly',
        operations: ctx.userId === 'alpha' ? alphaOps : betaOps,
      }],
    })
    const read = tools.find((tool) => tool.name === 'read')
    expect(read).toBeDefined()

    const alpha = await read!.execute(
      { filesystem: 'company_context', path: '/' },
      { abortSignal: new AbortController().signal, toolCallId: 'read-alpha', userId: 'alpha' },
    )
    const beta = await read!.execute(
      { filesystem: 'company_context', path: '/' },
      { abortSignal: new AbortController().signal, toolCallId: 'read-beta', userId: 'beta' },
    )

    expect(alpha.content[0]?.text).toBe('alpha-context')
    expect(beta.content[0]?.text).toBe('beta-context')
    expect(alphaOps.read).toHaveBeenCalledTimes(1)
    expect(betaOps.read).toHaveBeenCalledTimes(1)
  })

  test('explicit company_context routes read ls find and grep to readonly company operations', async () => {
    const operations = mockReadonlyBindingOperations()
    const tools = buildFilesystemAgentTools(withFilesystemBinding(mockBundle('direct'), operations))

    const read = tools.find((tool) => tool.name === 'read')!
    const ls = tools.find((tool) => tool.name === 'ls')!
    const find = tools.find((tool) => tool.name === 'find')!
    const grep = tools.find((tool) => tool.name === 'grep')!

    await expect(read.execute({ filesystem: 'company_context', path: '/company/hr/policy.md' }, { abortSignal: new AbortController().signal, toolCallId: 'company-read' }))
      .resolves.toMatchObject({
        content: [{ text: expect.stringContaining('company read /company/hr/policy.md') }],
        details: { metadata: { filesystem: 'company_context', path: '/company/hr/policy.md', operation: 'read' } },
      })
    await expect(ls.execute({ filesystem: 'company_context', path: '/company' }, { abortSignal: new AbortController().signal, toolCallId: 'company-ls' }))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('company list /company') }] })
    await expect(find.execute({ filesystem: 'company_context', path: '/company', pattern: '*.md' }, { abortSignal: new AbortController().signal, toolCallId: 'company-find' }))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('/company/*.md') }] })
    await expect(grep.execute({ filesystem: 'company_context', path: '/company', pattern: 'vacation' }, { abortSignal: new AbortController().signal, toolCallId: 'company-grep' }))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('company grep vacation') }] })

    expect(operations.read).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/company/hr/policy.md' })
    expect(operations.list).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/company' })
    expect(operations.find).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/company' }, '*.md', { limit: undefined })
    expect(operations.grep).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/company' }, 'vacation', { limit: undefined })
    logToolE2e({ tool: 'read', filesystem: 'company_context', path: '/company/hr/policy.md', expectedBinding: 'company_context', resultSummary: 'company read returned metadata' })
    logToolE2e({ tool: 'ls', filesystem: 'company_context', path: '/company', expectedBinding: 'company_context', resultSummary: 'company list returned allowed entries' })
    logToolE2e({ tool: 'find', filesystem: 'company_context', path: '/company', pattern: '*.md', expectedBinding: 'company_context', resultSummary: 'company find returned allowed paths' })
    logToolE2e({ tool: 'grep', filesystem: 'company_context', path: '/company', pattern: 'vacation', expectedBinding: 'company_context', resultSummary: 'company grep returned allowed matches' })
  })

  test('company_context mutation tools reject readonly binding and path spoofing does not switch filesystem', async () => {
    const operations = mockReadonlyBindingOperations()
    const tools = buildFilesystemAgentTools(withFilesystemBinding(mockBundle('direct'), operations))
    const write = tools.find((tool) => tool.name === 'write')!
    const read = tools.find((tool) => tool.name === 'read')!

    await expect(write.execute(
      { filesystem: 'company_context', path: '/company/hr/policy.md', content: 'mutate' },
      { abortSignal: new AbortController().signal, toolCallId: 'company-write' },
    )).rejects.toThrow('company_context is readonly for write')
    expect(operations.rejectMutation).toHaveBeenCalledWith('write', { filesystem: 'company_context', path: '/company/hr/policy.md' })

    await expect(read.execute(
      { filesystem: 'company_context', path: 'company_context:/company/hr/policy.md' },
      { abortSignal: new AbortController().signal, toolCallId: 'company-spoof-uri' },
    )).rejects.toThrow('filesystem prefixes are not valid path strings')
    await expect(read.execute(
      { filesystem: 'company_context', path: '/company_context/company/hr/policy.md' },
      { abortSignal: new AbortController().signal, toolCallId: 'company-spoof-prefix' },
    )).rejects.toThrow('filesystem prefixes are not valid path strings')
    expect(operations.read).not.toHaveBeenCalledWith({ filesystem: 'company_context', path: 'company_context:/company/hr/policy.md' })
    logToolE2e({ tool: 'write', filesystem: 'company_context', path: '/company/hr/policy.md', expectedBinding: 'company_context-readonly', resultSummary: 'mutation rejected' })
    logToolE2e({ tool: 'read', filesystem: 'company_context', path: '<spoof>', expectedBinding: 'none', resultSummary: 'path spoof rejected before company read' })
  })

  test('company_context mutation tools use readwrite binding operations', async () => {
    const operations = mockReadonlyBindingOperations()
    operations.read = vi.fn(async () => ({ content: 'before target middle final after', mtimeMs: 123 }))
    operations.write = vi.fn(async () => ({ mtimeMs: 456 }))
    operations.mkdir = vi.fn(async () => ({}))
    const tools = buildFilesystemAgentTools(withFilesystemBinding(mockBundle('direct'), operations, 'readwrite'))
    const write = tools.find((tool) => tool.name === 'write')!
    const edit = tools.find((tool) => tool.name === 'edit')!

    await expect(write.execute(
      { filesystem: 'company_context', path: '/company/new.md', content: 'new content' },
      { abortSignal: new AbortController().signal, toolCallId: 'company-write' },
    )).resolves.toMatchObject({ content: [{ text: 'Wrote /company/new.md' }] })
    expect(operations.mkdir).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/company', recursive: true })
    expect(operations.write).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/company/new.md', content: 'new content' })

    await expect(edit.execute(
      {
        filesystem: 'company_context',
        path: '/company/existing.md',
        edits: [
          { oldText: 'target', newText: 'updated' },
          { oldText: 'final', newText: 'done' },
        ],
      },
      { abortSignal: new AbortController().signal, toolCallId: 'company-edit' },
    )).resolves.toMatchObject({ content: [{ text: 'Edited /company/existing.md' }] })
    expect(operations.write).toHaveBeenCalledWith({
      filesystem: 'company_context',
      path: '/company/existing.md',
      content: 'before updated middle done after',
      expectedMtimeMs: 123,
    })
    expect(operations.rejectMutation).not.toHaveBeenCalled()

    vi.mocked(operations.read).mockResolvedValueOnce({ content: 'a', mtimeMs: 456 })
    await expect(edit.execute(
      {
        filesystem: 'company_context',
        path: '/company/existing.md',
        edits: [
          { oldText: 'a', newText: 'b' },
          { oldText: 'b', newText: 'c' },
        ],
      },
      { abortSignal: new AbortController().signal, toolCallId: 'company-edit-invalid-chain' },
    )).rejects.toThrow('found 0')

    vi.mocked(operations.read).mockResolvedValueOnce({ content: 'aaa', mtimeMs: 789 })
    await expect(edit.execute(
      {
        filesystem: 'company_context',
        path: '/company/existing.md',
        edits: [{ oldText: 'aa', newText: 'x' }],
      },
      { abortSignal: new AbortController().signal, toolCallId: 'company-edit-overlapping-match' },
    )).rejects.toThrow('found 2')
  })

  test('remote filesystem tools also accept company_context without bypassing workspace user default', async () => {
    const operations = mockReadonlyBindingOperations()
    const bundle = withFilesystemBinding(mockBundle('vercel-sandbox'), operations)
    vi.mocked(bundle.workspace.readFile).mockResolvedValueOnce('remote user content')
    const tools = buildFilesystemAgentTools(bundle)
    const read = tools.find((tool) => tool.name === 'read')!

    const userResult = await read.execute(
      { filesystem: 'user', path: 'remote.txt' },
      { abortSignal: new AbortController().signal, toolCallId: 'remote-user' },
    )
    const companyResult = await read.execute(
      { filesystem: 'company_context', path: '/company/hr/policy.md' },
      { abortSignal: new AbortController().signal, toolCallId: 'remote-company' },
    )

    expect(userResult.content[0].text).toContain('remote user content')
    expect(companyResult.content[0].text).toContain('company read /company/hr/policy.md')
    expect(bundle.workspace.readFile).toHaveBeenCalledWith('remote.txt')
    expect(operations.read).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/company/hr/policy.md' })
  })

  test('workspace write and edit respect readonly skill path guard', async () => {
    const readonlyPaths: string[] = []
    const tools = buildFilesystemAgentTools(mockBundle('direct'), {
      isReadonlyWorkspacePath: (path) => {
        readonlyPaths.push(path)
        return path.startsWith('.boring-agent/skills/')
      },
    })
    const write = tools.find((tool) => tool.name === 'write')!
    const edit = tools.find((tool) => tool.name === 'edit')!
    const ctx = { abortSignal: new AbortController().signal, toolCallId: 'readonly-skill-mutation' }

    await expect(write.execute(
      { path: '.boring-agent/skills/plugin/skill/SKILL.md', content: '# Mutated\n' },
      ctx,
    )).rejects.toThrow('skill file is readonly')
    await expect(edit.execute(
      { path: '.boring-agent/skills/plugin/skill/SKILL.md', edits: [{ oldText: 'a', newText: 'b' }] },
      ctx,
    )).rejects.toThrow('skill file is readonly')
    await expect(write.execute(
      { path: '/workspace/.boring-agent/skills/plugin/skill/SKILL.md', content: '# Mutated\n' },
      ctx,
    )).rejects.toThrow('skill file is readonly')
    expect(readonlyPaths).toEqual([
      '.boring-agent/skills/plugin/skill/SKILL.md',
      '.boring-agent/skills/plugin/skill/SKILL.md',
      '.boring-agent/skills/plugin/skill/SKILL.md',
    ])
  })

  test('direct find rejects absolute paths outside the workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'filesystem-tools-'))
    try {
      const tools = buildFilesystemAgentTools(mockBundle('direct', workspaceRoot))
      const find = tools.find((tool) => tool.name === 'find')
      expect(find).toBeDefined()

      await expect(
        find!.execute(
          { pattern: '*', path: '/etc', limit: 1 },
          { abortSignal: new AbortController().signal, toolCallId: 'find-escape' },
        ),
      ).rejects.toThrow('outside workspace')
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('direct grep rejects absolute paths outside the workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'filesystem-tools-'))
    try {
      const tools = buildFilesystemAgentTools(mockBundle('direct', workspaceRoot))
      const grep = tools.find((tool) => tool.name === 'grep')
      expect(grep).toBeDefined()

      await expect(
        grep!.execute(
          { pattern: 'root', path: '/etc/passwd', limit: 1 },
          { abortSignal: new AbortController().signal, toolCallId: 'grep-escape' },
        ),
      ).rejects.toThrow('Path not found: /etc/passwd')
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

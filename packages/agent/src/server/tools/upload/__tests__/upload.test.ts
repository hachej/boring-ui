import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import type { Workspace } from '../../../../shared/workspace'
import type { RuntimeBundle } from '../../../runtime/mode'
import { buildUploadAgentTools } from '../index'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function mockWorkspace(): Workspace {
  const runtimeContext = { runtimeCwd: '/workspace' }
  return {
    root: runtimeContext.runtimeCwd,
    runtimeContext,
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => {}),
    writeBinaryFile: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    stat: vi.fn(async () => ({ size: 0, mtimeMs: 0, kind: 'file' as const })),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
  }
}

function mockSandbox(): Sandbox {
  const runtimeContext = { runtimeCwd: '/workspace' }
  const defaultResult: ExecResult = {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 1,
    truncated: false,
  }
  return {
    id: 'mock-bwrap',
    placement: 'server',
    provider: 'bwrap',
    capabilities: ['exec'],
    runtimeContext,
    exec: vi.fn(async () => defaultResult),
  }
}

describe('buildUploadAgentTools', () => {
  test('uses host storage root while runtime cwd is /workspace', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'upload-tool-local-'))
    tempDirs.push(storageRoot)
    await writeFile(join(storageRoot, 'plot.png'), new Uint8Array([1, 2, 3]))
    const runtimeContext = { runtimeCwd: '/workspace' }
    const workspace = mockWorkspace()
    const bundle: RuntimeBundle = {
      runtimeContext,
      storageRoot,
      workspace,
      sandbox: mockSandbox(),
      fileSearch: { search: vi.fn(async () => []) },
    }
    const [upload] = buildUploadAgentTools(bundle)

    const result = await upload.execute(
      { path: 'plot.png' },
      { abortSignal: new AbortController().signal, toolCallId: 'upload-local-host-root' },
    )

    expect(result.isError).toBe(false)
    expect(workspace.mkdir).toHaveBeenCalledWith('assets/images', { recursive: true })
    expect(workspace.writeBinaryFile).toHaveBeenCalledWith(
      expect.stringMatching(/^assets\/images\/plot-[a-z0-9]+-[a-z0-9]+\.png$/),
      expect.any(Buffer),
    )
  })

  test('rejects readonly skill destination directories', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'upload-tool-readonly-'))
    tempDirs.push(storageRoot)
    await writeFile(join(storageRoot, 'plot.png'), new Uint8Array([1, 2, 3]))
    const workspace = mockWorkspace()
    const bundle: RuntimeBundle = {
      runtimeContext: { runtimeCwd: '/workspace' },
      storageRoot,
      workspace,
      sandbox: mockSandbox(),
      fileSearch: { search: vi.fn(async () => []) },
    }
    const [upload] = buildUploadAgentTools(bundle, {
      isReadonlyWorkspacePath: (path) => path.startsWith('.boring-agent/skills'),
    })

    const result = await upload.execute(
      { path: 'plot.png', directory: '.boring-agent/skills/plugin/skill' },
      { abortSignal: new AbortController().signal, toolCallId: 'upload-readonly-skill' },
    )

    expect(result).toMatchObject({ isError: true })
    expect(result.content[0]?.text).toContain('skill file is readonly')
    expect(workspace.mkdir).not.toHaveBeenCalled()
    expect(workspace.writeBinaryFile).not.toHaveBeenCalled()
  })
})

import { vi, describe, it, expect } from 'vitest'
import type { Sandbox, Workspace } from '@hachej/boring-agent/shared'
import { remoteSandboxBashOps } from '../remoteSandbox'

function fakeSandbox(exitCode: number): Sandbox {
  return {
    id: 'sandbox-test',
    provider: 'test',
    placement: 'remote',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace' },
    exec: vi.fn().mockResolvedValue({ exitCode }),
  }
}

function fakeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    root: '/workspace',
    runtimeContext: { runtimeCwd: '/workspace' },
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readBinaryFile: vi.fn(),
    writeBinaryFile: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    ...overrides,
  }
}

describe('remoteSandboxBashOps', () => {
  it('calls workspace.notifyExternalChange on successful exec', async () => {
    const mockSandbox = fakeSandbox(0)
    const notifyExternalChange = vi.fn()
    const mockWorkspace = fakeWorkspace({ notifyExternalChange })

    const ops = remoteSandboxBashOps(mockSandbox, mockWorkspace)
    await ops.exec('touch /workspace/test.txt', '/workspace', { onData: () => {} })

    expect(mockSandbox.exec).toHaveBeenCalled()
    expect(notifyExternalChange).toHaveBeenCalledWith({
      type: 'resync-required',
      reason: 'bash_tool_mutation',
    })
  })

  it('does not call workspace.notifyExternalChange on failed exec', async () => {
    const mockSandbox = fakeSandbox(1)
    const notifyExternalChange = vi.fn()
    const mockWorkspace = fakeWorkspace({ notifyExternalChange })

    const ops = remoteSandboxBashOps(mockSandbox, mockWorkspace)
    await ops.exec('false', '/workspace', { onData: () => {} })

    expect(mockSandbox.exec).toHaveBeenCalled()
    expect(notifyExternalChange).not.toHaveBeenCalled()
  })

  it('does not fail if workspace does not have notifyExternalChange', async () => {
    const mockSandbox = fakeSandbox(0)
    const mockWorkspace = fakeWorkspace()

    const ops = remoteSandboxBashOps(mockSandbox, mockWorkspace)
    await expect(
      ops.exec('true', '/workspace', { onData: () => {} }),
    ).resolves.not.toThrow()
  })
})

import { vi, describe, it, expect } from 'vitest'
import type { Sandbox, Workspace } from '@hachej/boring-agent/shared'
import { remoteSandboxBashOps } from '../remoteSandbox'

describe('remoteSandboxBashOps', () => {
  it('calls workspace.notifyExternalChange on successful exec', async () => {
    const mockSandbox: Sandbox = {
      provider: 'test',
      placement: 'remote',
      exec: vi.fn().mockResolvedValue({ exitCode: 0 }),
    }

    const mockWorkspace: Workspace & { notifyExternalChange?: (e: any) => void } = {
      root: '/workspace',
      fsCapability: 'best-effort',
      notifyExternalChange: vi.fn(),
      // Add other required Workspace methods if needed for compilation
      readFile: vi.fn(),
      writeFile: vi.fn(),
      readBinaryFile: vi.fn(),
      writeBinaryFile: vi.fn(),
      unlink: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      mkdir: vi.fn(),
      rename: vi.fn(),
    }

    const ops = remoteSandboxBashOps(mockSandbox, mockWorkspace)
    await ops.exec('touch /workspace/test.txt', '/workspace', { onData: () => {} })

    expect(mockSandbox.exec).toHaveBeenCalled()
    expect(mockWorkspace.notifyExternalChange).toHaveBeenCalledWith({
      type: 'resync-required',
      reason: 'bash_tool_mutation',
    })
  })

  it('does not call workspace.notifyExternalChange on failed exec', async () => {
    const mockSandbox: Sandbox = {
      provider: 'test',
      placement: 'remote',
      exec: vi.fn().mockResolvedValue({ exitCode: 1 }),
    }

    const mockWorkspace: Workspace & { notifyExternalChange?: (e: any) => void } = {
      root: '/workspace',
      fsCapability: 'best-effort',
      notifyExternalChange: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      readBinaryFile: vi.fn(),
      writeBinaryFile: vi.fn(),
      unlink: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      mkdir: vi.fn(),
      rename: vi.fn(),
    }

    const ops = remoteSandboxBashOps(mockSandbox, mockWorkspace)
    await ops.exec('false', '/workspace', { onData: () => {} })

    expect(mockSandbox.exec).toHaveBeenCalled()
    expect(mockWorkspace.notifyExternalChange).not.toHaveBeenCalled()
  })

  it('does not fail if workspace does not have notifyExternalChange', async () => {
    const mockSandbox: Sandbox = {
      provider: 'test',
      placement: 'remote',
      exec: vi.fn().mockResolvedValue({ exitCode: 0 }),
    }

    const mockWorkspace: Workspace = {
      root: '/workspace',
      fsCapability: 'best-effort',
      // no notifyExternalChange method
      readFile: vi.fn(),
      writeFile: vi.fn(),
      readBinaryFile: vi.fn(),
      writeBinaryFile: vi.fn(),
      unlink: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      mkdir: vi.fn(),
      rename: vi.fn(),
    }

    const ops = remoteSandboxBashOps(mockSandbox, mockWorkspace)
    await expect(ops.exec('true', '/workspace', { onData: () => {} })).resolves.not.toThrow()
  })
})

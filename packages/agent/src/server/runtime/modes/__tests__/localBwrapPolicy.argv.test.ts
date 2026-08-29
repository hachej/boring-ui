import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

const providerOptions = vi.hoisted(() => [] as unknown[])
vi.mock('@hachej/boring-sandbox/providers/bwrap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hachej/boring-sandbox/providers/bwrap')>()
  return {
    ...actual,
    createBwrapSandboxProvider(options: unknown) {
      providerOptions.push(options)
      const provider = actual.createBwrapSandboxProvider()
      return {
        ...provider,
        async create() {
          const runtimeContext = { runtimeCwd: '/workspace' }
          return {
            workspace: {
              root: '/workspace',
              runtimeContext,
              fsCapability: 'strong' as const,
              async readFile() { return '' },
              async writeFile() {},
              async unlink() {},
              async readdir() { return [] },
              async stat() { return { kind: 'file' as const, size: 0, mtimeMs: 0 } },
              async mkdir() {},
              async rename() {},
            },
            sandbox: {
              id: 'captured-bwrap',
              placement: 'server' as const,
              provider: 'bwrap',
              capabilities: ['exec'] as const,
              runtimeContext,
              async exec() {
                return {
                  stdout: new Uint8Array(),
                  stderr: new Uint8Array(),
                  exitCode: 0,
                  durationMs: 0,
                  truncated: false,
                }
              },
            },
            async dispose() {},
          }
        },
      }
    },
  }
})

import { createSandboxRuntimeModeAdapter } from '../../sandboxRuntimeHost'
import { createLocalProvisioningAdapter } from '../provisioningAdapter'

const tempDirs: string[] = []
afterEach(async () => {
  providerOptions.length = 0
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function expectDockerPolicyArgs(args: readonly string[]): void {
  expect(args).not.toContain('--unshare-all')
  expect(args.slice(0, 4)).toEqual([
    '--unshare-ipc',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-cgroup',
  ])
  expect(args).toContain('--cap-drop')
  expect(args[args.indexOf('--cap-drop') + 1]).toBe('ALL')
}

test('local runtime carries one docker bwrap policy into provisioning argv', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-local-policy-'))
  tempDirs.push(workspaceRoot)
  const adapter = createSandboxRuntimeModeAdapter('local', {
    bwrap: {
      sandbox: {
        namespaceProfile: 'docker',
        network: 'shared',
        dropAllCapabilities: false,
      },
    },
  })
  const bundle = await adapter.create({ workspaceRoot, sessionId: 'policy-test' })

  expect(providerOptions).toEqual([{
    sandbox: {
      namespaceProfile: 'docker',
      network: 'shared',
      dropAllCapabilities: true,
    },
  }])
  const runtimeHost = bundle.runtimeHost
  expect(runtimeHost).toBeDefined()
  expectDockerPolicyArgs(runtimeHost!.buildBwrapArgs(workspaceRoot))

  const runner = vi.fn(async (_command: string, _args: string[]) => ({ stdout: '', stderr: '', exitCode: 0 }))
  const provisioning = createLocalProvisioningAdapter(
    runtimeHost!.getBoringAgentRuntimePaths(workspaceRoot),
    runtimeHost!,
    runner,
  )
  await provisioning.exec('/usr/bin/true', [], {})

  expect(runner).toHaveBeenCalledOnce()
  const [command, args] = runner.mock.calls[0]
  expect(command).toBe('bwrap')
  expectDockerPolicyArgs(args)
  expect(args).toContain('--dir')
  expect(args).toContain('/mnt/boring-agent-sources')
  await bundle.disposeRuntime?.()
  await adapter.dispose?.()
})

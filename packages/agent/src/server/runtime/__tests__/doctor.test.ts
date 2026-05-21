import Fastify from 'fastify'
import { expect, test, vi } from 'vitest'

import type { RuntimeBundle } from '../mode'
import { buildRuntimeDoctorReport, runtimeDoctorRoutes } from '../doctor'
import type { Sandbox } from '../../../shared/sandbox'
import type { Workspace } from '../../../shared/workspace'

const encoder = new TextEncoder()

function bytes(value: string): Uint8Array {
  return encoder.encode(value)
}

function mockBundle(): RuntimeBundle {
  const runtimeContext = { runtimeCwd: '/workspace' }
  const workspace: Workspace = {
    root: '/workspace',
    runtimeContext,
    fsCapability: 'strong',
    async readFile(path) {
      if (path === '.boring-agent/state/provisioning.json') {
        return JSON.stringify({
          v: 6,
          fingerprint: 'sha256:abc123',
          runtimeMode: 'local',
          runtimeCwd: '/workspace',
          sandboxProvider: 'bwrap',
        })
      }
      const error = new Error('not found') as Error & { code: string }
      error.code = 'ENOENT'
      throw error
    },
    async readBinaryFile() { return new Uint8Array() },
    async writeFile() {},
    async writeBinaryFile() {},
    async readFileWithStat() { throw new Error('not implemented') },
    async writeFileWithStat() { throw new Error('not implemented') },
    async writeBinaryFileWithStat() { throw new Error('not implemented') },
    async unlink() {},
    async mkdir() {},
    async rename() {},
    async readdir() { return [] },
    async stat() { throw new Error('not implemented') },
  }
  const sandbox: Sandbox = {
    id: 'bwrap-test',
    placement: 'server',
    provider: 'bwrap',
    capabilities: ['exec'],
    runtimeContext,
    exec: vi.fn(async () => ({
      stdout: bytes([
        '__boring_doctor_cwd=/workspace',
        '__boring_doctor_boring_root=/workspace',
        '__boring_doctor_virtual_env=/workspace/.boring-agent/venv',
        '__boring_doctor_path_entry=/workspace/.boring-agent/bin',
        '__boring_doctor_path_entry=/workspace/.boring-agent/venv/bin',
        '__boring_doctor_python_executable=/workspace/.boring-agent/venv/bin/python',
        '__boring_doctor_python_version=Python 3.12.0',
        '__boring_doctor_pip_version=pip 24.0 from /workspace/.boring-agent/venv/lib/python3.12/site-packages/pip (python 3.12)',
      ].join('\n')),
      stderr: bytes(''),
      exitCode: 0,
      durationMs: 12,
      truncated: false,
      stdoutEncoding: 'utf-8' as const,
      stderrEncoding: 'utf-8' as const,
    })),
  }
  return {
    runtimeContext,
    workspace,
    sandbox,
    fileSearch: { search: vi.fn(async () => []) },
    storageRoot: '/tmp/host-workspace',
  }
}

test('runtime doctor report includes cwd/env/artifacts/python/provisioning state without host storage root', async () => {
  const report = await buildRuntimeDoctorReport({
    version: 'test-version',
    runtimeMode: 'local',
    bundle: mockBundle(),
  })

  expect(report.status).toBe('ok')
  expect(report.runtimeCwd).toBe('/workspace')
  expect(report.workspaceRoot).toBe('/workspace')
  expect(report.env.cwd).toBe('/workspace')
  expect(report.env.boringAgentWorkspaceRoot).toBe('/workspace')
  expect(report.env.virtualEnv).toBe('/workspace/.boring-agent/venv')
  expect(report.env.pathFirstEntries).toEqual([
    '/workspace/.boring-agent/bin',
    '/workspace/.boring-agent/venv/bin',
  ])
  expect(report.artifactRoots).toMatchObject({
    root: '/workspace/.boring-agent',
    bin: '/workspace/.boring-agent/bin',
    venv: '/workspace/.boring-agent/venv',
    provisioningMarker: '/workspace/.boring-agent/state/provisioning.json',
  })
  expect(report.python).toMatchObject({
    available: true,
    executable: '/workspace/.boring-agent/venv/bin/python',
    version: 'Python 3.12.0',
  })
  expect(report.provisioning).toMatchObject({
    expectedVersion: 6,
    present: true,
    source: 'current',
    version: 6,
    fingerprint: 'sha256:abc123',
    runtimeMode: 'local',
    runtimeCwd: '/workspace',
    sandboxProvider: 'bwrap',
  })
  expect(JSON.stringify(report)).not.toContain('/tmp/host-workspace')
})

test('runtime doctor route serves smoke report', async () => {
  const app = Fastify({ logger: false })
  await app.register(runtimeDoctorRoutes, {
    version: 'route-test',
    runtimeMode: 'local',
    bundle: mockBundle(),
  })

  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/runtime/doctor' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      version: 'route-test',
      runtimeMode: 'local',
      runtimeCwd: '/workspace',
      env: {
        boringAgentWorkspaceRoot: '/workspace',
      },
      provisioning: {
        fingerprint: 'sha256:abc123',
      },
    })
  } finally {
    await app.close()
  }
})

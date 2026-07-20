import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

import { ErrorCode } from '../../../../shared/error-codes'
import { getBoringAgentRuntimePaths, testRuntimeHostOperations } from '@agent-test-host'
import { createVercelProvisioningAdapter } from '@agent-test-host'
import { ProvisioningError } from '../errors'
import { provisionWorkspaceRuntime } from '../provisionWorkspaceRuntime'
import type { WorkspaceProvisioningAdapter } from '../types'

interface LogEntry { message: string; fields?: Record<string, unknown> }

function createFailingAdapter(workspaceRoot: string, fail: 'layout' | 'skill' | 'template' | 'node' | 'python'): WorkspaceProvisioningAdapter {
  const toAbs = (rel: string) => join(workspaceRoot, rel)
  return {
    mode: 'direct',
    async exec(command, args) {
      if (command === 'node' && args[0] === '--version') return { stdout: 'v20.11.0\n' }
      if (command === 'npm' && args[0] === '--version') return { stdout: '10.2.4\n' }
      if (command === 'python3' && args[0] === '--version') return { stdout: 'Python 3.12.1\n' }
      if (command === 'uv' && args[0] === '--version') return { stdout: 'uv 0.5.0\n' }
      if (fail === 'node' && command === 'npm') throw new Error('npm boom SECRET_TOKEN=hidden')
      if (fail === 'python' && args[0] === 'venv') throw new Error('uv boom')
    },
    async resolveInstallSource(source) { return String(source) },
    workspaceFs: {
      async exists() { return false },
      async rm() {},
      async mkdir(rel) {
        if (fail === 'layout' && rel === '.boring-agent') throw new Error('mkdir denied')
      },
      async writeText() {},
      async readText() { return null },
      async copyFromHost() {
        if (fail === 'skill') throw new Error('skill copy denied')
        if (fail === 'template') throw new Error('template copy denied')
      },
    },
    getRuntimeCacheRoot() { return toAbs('.boring-agent/cache') },
  }
}

async function workspaceRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'boring-provision-errors-'))
}

test('provisioning failures carry stable canonical codes and context', async () => {
  const root = await workspaceRoot()
  const paths = getBoringAgentRuntimePaths(root)

  await expect(provisionWorkspaceRuntime({
    plugins: [],
    adapter: createFailingAdapter(root, 'layout'),
    runtimeLayout: paths,
    runtimeHost: testRuntimeHostOperations,
  })).rejects.toMatchObject({
    code: ErrorCode.enum.PROVISIONING_LAYOUT_FAILED,
    details: { phase: 'layout', workspaceRoot: root },
  })
})

test('phase logs include useful context without dumping env secrets', async () => {
  const root = await workspaceRoot()
  const paths = getBoringAgentRuntimePaths(root)
  const logs: LogEntry[] = []

  await expect(provisionWorkspaceRuntime({
    plugins: [{ id: 'cli', provisioning: { nodePackages: [{ id: 'cli', packageName: '@hachej/boring-ui-cli' }] } }],
    adapter: createFailingAdapter(root, 'node'),
    runtimeLayout: paths,
    runtimeHost: testRuntimeHostOperations,
    logger: {
      info(message, fields) { logs.push({ message, fields }) },
      error(message, fields) { logs.push({ message, fields }) },
    },
  })).rejects.toBeInstanceOf(ProvisioningError)

  expect(logs.some((entry) => entry.message.includes('layout started'))).toBe(true)
  expect(logs.some((entry) => entry.message.includes('node packages'))).toBe(true)
  expect(logs.some((entry) => entry.fields?.workspaceRoot === root)).toBe(true)
  expect(logs.some((entry) => Array.isArray(entry.fields?.packageIds))).toBe(true)
  expect(JSON.stringify(logs)).not.toContain('SECRET_TOKEN')
})

test('Vercel artifact failures use stable provisioning artifact code', async () => {
  const adapter = createVercelProvisioningAdapter({
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
    workspaceFs: {
      async exists() { return false },
      async rm() {},
      async mkdir() {},
      async writeText() {},
      async readText() { return null },
      async copyFromHost() {},
    },
    async exec() {},
    async prepareArtifact() {
      throw new Error('artifact pack failed')
    },
  })

  await expect(adapter.resolveInstallSource('/tmp/pkg', {
    kind: 'node',
    id: 'cli',
    fingerprint: 'sha256:abcdef',
  })).rejects.toMatchObject({
    code: ErrorCode.enum.PROVISIONING_ARTIFACT_FAILED,
    details: { phase: 'adapter-artifact', runtime: 'node', id: 'cli' },
  })
})

test('canonical provisioning codes are documented in ERROR_CODES.md', async () => {
  const docs = await readFile(new URL('../../../../../docs/ERROR_CODES.md', import.meta.url), 'utf8')
  for (const code of [
    'PROVISIONING_LAYOUT_FAILED',
    'PROVISIONING_SKILLS_FAILED',
    'PROVISIONING_TEMPLATES_FAILED',
    'PROVISIONING_NODE_PREFLIGHT_FAILED',
    'PROVISIONING_NPM_INSTALL_FAILED',
    'PROVISIONING_UV_BOOTSTRAP_FAILED',
    'PROVISIONING_UV_INSTALL_FAILED',
    'PROVISIONING_ARTIFACT_FAILED',
  ]) {
    expect(docs).toContain(`\`${code}\``)
  }
})

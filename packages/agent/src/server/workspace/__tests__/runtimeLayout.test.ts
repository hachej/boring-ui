import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'

import {
  BORING_AGENT_DIR,
  getBoringAgentPathEntries,
  getBoringAgentRuntimeEnv,
  getBoringAgentRuntimePaths,
} from '@hachej/boring-bash/agent'
import {
  BORING_AGENT_GITIGNORE_CONTENT,
  BORING_AGENT_RUNTIME_DIR_NAMES,
} from '../runtimeLayout'

test('returns centralized workspace-local .boring-agent paths', () => {
  const workspaceRoot = resolve('/tmp/example-workspace')
  const paths = getBoringAgentRuntimePaths(workspaceRoot)

  expect(BORING_AGENT_DIR).toBe('.boring-agent')
  expect(BORING_AGENT_RUNTIME_DIR_NAMES).toEqual([
    'node',
    'venv',
    'sdk',
    'skills',
    'cache',
    'tmp',
  ])
  expect(paths).toEqual({
    workspaceRoot,
    agentDir: join(workspaceRoot, '.boring-agent'),
    node: join(workspaceRoot, '.boring-agent', 'node'),
    nodeModules: join(workspaceRoot, '.boring-agent', 'node', 'node_modules'),
    nodeBin: join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin'),
    venv: join(workspaceRoot, '.boring-agent', 'venv'),
    venvBin: join(workspaceRoot, '.boring-agent', 'venv', 'bin'),
    venvPython: join(workspaceRoot, '.boring-agent', 'venv', 'bin', 'python'),
    sdk: join(workspaceRoot, '.boring-agent', 'sdk'),
    uvHome: join(workspaceRoot, '.boring-agent', 'sdk', 'uv'),
    uvBin: join(workspaceRoot, '.boring-agent', 'sdk', 'uv', 'bin'),
    skills: join(workspaceRoot, '.boring-agent', 'skills'),
    cache: join(workspaceRoot, '.boring-agent', 'cache'),
    nodeCache: join(workspaceRoot, '.boring-agent', 'cache', 'npm'),
    uvCache: join(workspaceRoot, '.boring-agent', 'cache', 'uv'),
    pipCache: join(workspaceRoot, '.boring-agent', 'cache', 'pip'),
    tmp: join(workspaceRoot, '.boring-agent', 'tmp'),
  })
})

test('does not include deferred state or logs directories in first-pass layout', () => {
  const paths = getBoringAgentRuntimePaths('/tmp/example-workspace')

  expect(BORING_AGENT_RUNTIME_DIR_NAMES).not.toContain('state')
  expect(BORING_AGENT_RUNTIME_DIR_NAMES).not.toContain('logs')
  expect(Object.keys(paths)).not.toContain('state')
  expect(Object.keys(paths)).not.toContain('logs')
  expect(Object.keys(paths)).not.toContain('provisioningState')
  expect(Object.keys(paths)).not.toContain('skillMirrorState')
})

test('supports Vercel-style runtime-visible workspace roots', () => {
  const paths = getBoringAgentRuntimePaths('/workspace')

  expect(paths.workspaceRoot).toBe('/workspace')
  expect(paths.agentDir).toBe('/workspace/.boring-agent')
  expect(paths.skills).toBe('/workspace/.boring-agent/skills')
  expect(paths.nodeBin).toBe('/workspace/.boring-agent/node/node_modules/.bin')
  expect(paths.venvBin).toBe('/workspace/.boring-agent/venv/bin')
})

test('derives PATH entries and runtime env from layout and adapter cache root', () => {
  const paths = getBoringAgentRuntimePaths('/workspace')
  const cacheRoot = '/tmp/boring-agent-cache'

  expect(getBoringAgentPathEntries(paths)).toEqual([
    '/workspace/.boring-agent/node/node_modules/.bin',
    '/workspace/.boring-agent/venv/bin',
    '/workspace/.boring-agent/sdk/uv/bin',
  ])
  expect(getBoringAgentRuntimeEnv(paths, cacheRoot)).toEqual({
    BORING_AGENT_WORKSPACE_ROOT: '/workspace',
    VIRTUAL_ENV: '/workspace/.boring-agent/venv',
    UV_CACHE_DIR: '/tmp/boring-agent-cache/uv',
    PIP_CACHE_DIR: '/tmp/boring-agent-cache/pip',
    npm_config_cache: '/tmp/boring-agent-cache/npm',
  })
})

test('defaults cache env to workspace-local .boring-agent/cache', () => {
  const paths = getBoringAgentRuntimePaths('/workspace')

  expect(getBoringAgentRuntimeEnv(paths)).toMatchObject({
    UV_CACHE_DIR: '/workspace/.boring-agent/cache/uv',
    PIP_CACHE_DIR: '/workspace/.boring-agent/cache/pip',
    npm_config_cache: '/workspace/.boring-agent/cache/npm',
  })
})

test('provides generated .gitignore content for the runtime directory', () => {
  expect(BORING_AGENT_GITIGNORE_CONTENT).toBe('*\n')
})

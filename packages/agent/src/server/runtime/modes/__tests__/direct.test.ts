import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { directModeAdapter } from '../direct'

const decoder = new TextDecoder()
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeWorkspaceRoot(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-agent-direct-mode-'))
  tempDirs.push(workspaceRoot)
  return workspaceRoot
}

test('direct mode runtime bundle uses the host workspace path as runtime cwd', async () => {
  const workspaceRoot = await makeWorkspaceRoot()

  const bundle = await directModeAdapter.create({
    workspaceRoot,
    sessionId: 'direct-runtime-cwd',
  })

  expect(bundle.runtimeContext.runtimeCwd).toBe(workspaceRoot)
  expect(bundle.runtimeContext.runtimeCwd).not.toBe('/workspace')
  expect(bundle.storageRoot).toBe(workspaceRoot)
  expect(bundle.workspace.root).toBe(workspaceRoot)
  expect(bundle.workspace.runtimeContext.runtimeCwd).toBe(workspaceRoot)
  expect(bundle.sandbox.runtimeContext.runtimeCwd).toBe(workspaceRoot)
  expect(bundle.workspace.root).toBe(bundle.sandbox.runtimeContext.runtimeCwd)
  expect(bundle.sandbox.provider).toBe('direct')

  const result = await bundle.sandbox.exec(
    'printf "%s\\n%s\\n%s" "$(pwd)" "$PWD" "$BORING_AGENT_WORKSPACE_ROOT"',
  )
  const [pwd, envPwd, boringRoot] = decoder.decode(result.stdout).split('\n')

  expect(result.exitCode).toBe(0)
  expect(pwd).toBe(workspaceRoot)
  expect(envPwd).toBe(workspaceRoot)
  expect(boringRoot).toBe(workspaceRoot)
  expect([pwd, envPwd, boringRoot]).not.toContain('/workspace')
})

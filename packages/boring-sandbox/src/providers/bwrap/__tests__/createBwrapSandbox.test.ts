import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { createNodeWorkspace } from '../../node-workspace/createNodeWorkspace'
import { computeSandboxCwd, createBwrapSandbox } from '../createBwrapSandbox'

const tempDirs: string[] = []
const HAS_BWRAP = (() => {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

function setEnvForTest(name: string, value: string | undefined): string | undefined {
  const previous = process.env[name]
  if (typeof value === 'string') {
    process.env[name] = value
  } else {
    delete process.env[name]
  }
  return previous
}

function restoreEnvForTest(name: string, previous: string | undefined): void {
  if (typeof previous === 'string') {
    process.env[name] = previous
  } else {
    delete process.env[name]
  }
}

async function setupSandbox() {
  const root = await mkdtemp(join(tmpdir(), 'boring-ui-bwrap-sandbox-'))
  tempDirs.push(root)

  const runtimeContext = { runtimeCwd: '/workspace' }
  const workspace = createNodeWorkspace(root, { runtimeContext })
  const sandbox = createBwrapSandbox({ hostWorkspaceRoot: root, runtimeContext })
  await sandbox.init?.({ workspace, sessionId: 'session-1' })

  return { sandbox, workspace, root }
}

test('local runtime surfaces expose /workspace without leaking host root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boring-ui-bwrap-runtime-'))
  tempDirs.push(root)
  const runtimeContext = { runtimeCwd: '/workspace' }

  const workspace = createNodeWorkspace(root, { runtimeContext })
  const sandbox = createBwrapSandbox({ hostWorkspaceRoot: root, runtimeContext })

  expect(workspace.root).toBe('/workspace')
  expect(workspace.runtimeContext.runtimeCwd).toBe('/workspace')
  expect(sandbox.runtimeContext.runtimeCwd).toBe('/workspace')
  expect(workspace.root).toBe(sandbox.runtimeContext.runtimeCwd)
})

test('computeSandboxCwd rejects runtime namespace traversal', () => {
  const root = '/tmp/host-workspace'

  expect(() => computeSandboxCwd(root, '/workspace', '/workspace/..')).toThrow(
    'cwd must stay within workspace root',
  )
  expect(() => computeSandboxCwd(root, '/workspace', '/workspace/../tmp')).toThrow(
    'cwd must stay within workspace root',
  )
})

test('init verifies bwrap binary exists on PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boring-ui-bwrap-check-'))
  tempDirs.push(root)

  const sandbox = createBwrapSandbox()
  const workspace = createNodeWorkspace(root)

  const originalPath = setEnvForTest('PATH', '')
  try {
    await expect(sandbox.init?.({ workspace, sessionId: 'session-check' }))
      .rejects
      .toThrow('not found on PATH')
  } finally {
    restoreEnvForTest('PATH', originalPath)
  }
})

const describeIfBwrap = HAS_BWRAP ? describe : describe.skip

describeIfBwrap('createBwrapSandbox', () => {
  test('bwrap happy path executes command and returns stdout', async () => {
    const { sandbox } = await setupSandbox()

    const result = await sandbox.exec('echo hello')

    expect(Buffer.from(result.stdout).toString('utf-8')).toBe('hello\n')
    expect(result.exitCode).toBe(0)
    expect(result.truncated).toBe(false)
  })

  test('workspace writes are visible inside sandbox', async () => {
    const { sandbox, workspace } = await setupSandbox()
    await workspace.writeFile('note.txt', 'hello-from-workspace')

    const result = await sandbox.exec('cat /workspace/note.txt')

    expect(Buffer.from(result.stdout).toString('utf-8')).toBe('hello-from-workspace')
    expect(result.exitCode).toBe(0)
  })

  test('default cwd and PWD are /workspace and relative commands run there', async () => {
    const { sandbox, workspace, root } = await setupSandbox()
    await workspace.writeFile('note.txt', 'default-cwd-ok')

    const result = await sandbox.exec(
      'printf "%s\\n%s\\n" "$(pwd)" "$PWD" && cat note.txt',
      { env: { PATH: process.env.PATH ?? '', PWD: root } },
    )
    const output = Buffer.from(result.stdout).toString('utf-8')

    expect(output).toBe('/workspace\n/workspace\ndefault-cwd-ok')
    expect(output).not.toContain(root)
    expect(result.exitCode).toBe(0)
  })

  test('explicit runtime cwd sets pwd and PWD inside /workspace', async () => {
    const { sandbox, workspace, root } = await setupSandbox()
    await workspace.mkdir('nested', { recursive: true })
    await workspace.writeFile('nested/file.txt', 'runtime-cwd-ok')

    const result = await sandbox.exec(
      'printf "%s\\n%s\\n" "$(pwd)" "$PWD" && cat file.txt',
      { cwd: '/workspace/nested', env: { PATH: process.env.PATH ?? '', PWD: root } },
    )
    const output = Buffer.from(result.stdout).toString('utf-8')

    expect(output).toBe('/workspace/nested\n/workspace/nested\nruntime-cwd-ok')
    expect(output).not.toContain(root)
    expect(result.exitCode).toBe(0)
  })

  test('child runtime files are not shadowed by parent mounts', async () => {
    const parentRoot = await mkdtemp(join(tmpdir(), 'boring-ui-bwrap-parent-'))
    tempDirs.push(parentRoot)
    const childRoot = join(parentRoot, 'child')

    await mkdir(join(parentRoot, '.boring-agent', 'venv'), { recursive: true })
    await mkdir(join(parentRoot, '.venv'), { recursive: true })
    await mkdir(join(childRoot, '.boring-agent', 'venv'), { recursive: true })
    await mkdir(join(childRoot, '.venv'), { recursive: true })
    await writeFile(join(parentRoot, '.boring-agent', 'marker.txt'), 'parent-agent')
    await writeFile(join(parentRoot, '.boring-agent', 'venv', 'marker.txt'), 'parent-agent-venv')
    await writeFile(join(parentRoot, '.venv', 'marker.txt'), 'parent-venv')
    await writeFile(join(childRoot, '.boring-agent', 'marker.txt'), 'child-agent')
    await writeFile(join(childRoot, '.boring-agent', 'venv', 'marker.txt'), 'child-agent-venv')
    await writeFile(join(childRoot, '.venv', 'marker.txt'), 'child-venv')

    const workspace = createNodeWorkspace(childRoot)
    const sandbox = createBwrapSandbox()
    await sandbox.init?.({ workspace, sessionId: 'nested-shadow-check' })

    const result = await sandbox.exec([
      'cat /workspace/.boring-agent/marker.txt',
      'printf "\\n"',
      'cat /workspace/.boring-agent/venv/marker.txt',
    ].join(' && '))
    const output = Buffer.from(result.stdout).toString('utf-8')

    expect(output).toBe('child-agent\nchild-agent-venv')
    expect(output).not.toContain('parent-agent')
    expect(output).not.toContain('parent-venv')
    expect(result.exitCode).toBe(0)
  })

  test('parent runtime dirs are mounted only where the child lacks matching dirs', async () => {
    const parentRoot = await mkdtemp(join(tmpdir(), 'boring-ui-bwrap-parent-runtime-'))
    tempDirs.push(parentRoot)
    const childRoot = join(parentRoot, 'child')

    await mkdir(join(parentRoot, '.boring-agent', 'venv'), { recursive: true })
    await mkdir(join(parentRoot, '.venv'), { recursive: true })
    await mkdir(join(childRoot, '.boring-agent'), { recursive: true })
    await writeFile(join(parentRoot, '.boring-agent', 'marker.txt'), 'parent-agent')
    await writeFile(join(parentRoot, '.boring-agent', 'venv', 'marker.txt'), 'parent-agent-venv')
    await writeFile(join(parentRoot, '.venv', 'marker.txt'), 'parent-venv')
    await writeFile(join(childRoot, '.boring-agent', 'marker.txt'), 'child-agent')

    const workspace = createNodeWorkspace(childRoot)
    const sandbox = createBwrapSandbox()
    await sandbox.init?.({ workspace, sessionId: 'nested-parent-runtime' })

    const result = await sandbox.exec([
      'cat /workspace/.boring-agent/marker.txt',
      'printf "\\n"',
      'cat /workspace/.boring-agent/venv/marker.txt',
      'printf "\\n"',
      'test ! -e /workspace/.venv/marker.txt && printf "no-parent-venv"',
    ].join(' && '))
    const output = Buffer.from(result.stdout).toString('utf-8')

    expect(output).toBe('child-agent\nparent-agent-venv\nno-parent-venv')
    expect(output).not.toContain('parent-agent\n')
    expect(result.exitCode).toBe(0)
  })

  test('timeout is enforced', async () => {
    const { sandbox } = await setupSandbox()

    const result = await sandbox.exec('sleep 60', { timeoutMs: 1_000 })

    expect(result.exitCode).toBe(124)
    expect(result.durationMs).toBeGreaterThanOrEqual(1_000)
    expect(result.durationMs).toBeLessThan(4_000)
  }, 20_000)

  test('maxOutputBytes caps output and marks truncated', async () => {
    const { sandbox } = await setupSandbox()

    const result = await sandbox.exec('yes | head -c 10000000', {
      maxOutputBytes: 1_024,
    })

    expect(result.truncated).toBe(true)
    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(1_024)
  })

  test('resource limits are applied before the user command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-ui-bwrap-limits-'))
    tempDirs.push(root)
    const runtimeContext = { runtimeCwd: '/workspace' }
    const workspace = createNodeWorkspace(root, { runtimeContext })
    const sandbox = createBwrapSandbox({
      hostWorkspaceRoot: root,
      runtimeContext,
      resourceLimits: {
        cpuSeconds: 7,
        fileSizeBlocks: 11,
        maxProcesses: 512,
        openFiles: 64,
        virtualMemoryKb: 262_144,
      },
    })
    await sandbox.init?.({ workspace, sessionId: 'limits-check' })

    const result = await sandbox.exec(
      'printf "%s,%s,%s,%s,%s" "$(ulimit -t)" "$(ulimit -f)" "$(ulimit -u)" "$(ulimit -n)" "$(ulimit -v)"',
    )
    const output = Buffer.from(result.stdout).toString('utf-8')

    expect(result.exitCode).toBe(0)
    expect(output).toBe('7,11,512,64,262144')
  })

  test('cwd maps from host workspace path to /workspace', async () => {
    const { sandbox, workspace, root } = await setupSandbox()
    await workspace.mkdir('nested', { recursive: true })
    await workspace.writeFile('nested/file.txt', 'cwd-ok')

    const result = await sandbox.exec('pwd && cat file.txt', { cwd: join(root, 'nested') })
    const output = Buffer.from(result.stdout).toString('utf-8')

    expect(output).toContain('/workspace/nested')
    expect(output).toContain('cwd-ok')
    expect(result.exitCode).toBe(0)
  })
})

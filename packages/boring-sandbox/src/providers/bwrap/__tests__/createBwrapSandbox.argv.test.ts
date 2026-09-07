import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

const spawnCalls = vi.hoisted(() => [] as Array<{ command: string; args: string[] }>)

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn(command: string, args: readonly string[]) {
      spawnCalls.push({ command, args: [...args] })
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough
        stderr: PassThrough
        pid: number
      }
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.pid = 12345
      queueMicrotask(() => {
        child.stdout.end()
        child.stderr.end()
        child.emit('close', 0, null)
      })
      return child
    },
  }
})

import { createNodeWorkspace } from '../../node-workspace/createNodeWorkspace'
import { createBwrapSandbox } from '../createBwrapSandbox'

const tempDirs: string[] = []
afterEach(async () => {
  spawnCalls.length = 0
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('Sandbox.exec spawns the resolved docker namespace profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boring-bwrap-argv-'))
  tempDirs.push(root)
  const workspace = createNodeWorkspace(root)
  const sandbox = createBwrapSandbox({
    hostWorkspaceRoot: root,
    namespaceProfile: 'docker',
    dropAllCapabilities: false,
  })
  await sandbox.init?.({ workspace, sessionId: 'argv-test' })

  await sandbox.exec('true')

  const executionCalls = spawnCalls.filter((call) => !call.args.includes('--version'))
  expect(executionCalls).toHaveLength(1)
  const [{ command, args }] = executionCalls
  expect(command).toBe('bwrap')
  expect(args).not.toContain('--unshare-all')
  expect(args.slice(0, 4)).toEqual([
    '--unshare-ipc',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-cgroup',
  ])
  expect(args).toContain('--cap-drop')
  expect(args[args.indexOf('--cap-drop') + 1]).toBe('ALL')
  expect(args.slice(-3)).toEqual(['bash', '-c', 'true'])
})

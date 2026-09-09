import { expect, test } from 'vitest'

import {
  BWRAP_TIMEOUT_SECONDS,
  KILL_GRACE_SECONDS,
  RO_BIND_DIRS,
  RO_BIND_TRY_DIRS,
  buildBwrapArgs,
} from '../buildBwrapArgs'

function findTupleIndex(args: string[], tuple: string[]): number {
  for (let i = 0; i <= args.length - tuple.length; i += 1) {
    let matches = true
    for (let j = 0; j < tuple.length; j += 1) {
      if (args[i + j] !== tuple[j]) {
        matches = false
        break
      }
    }
    if (matches) {
      return i
    }
  }

  return -1
}

test('snapshot: known workspaceRoot emits expected args ordering', () => {
  expect(buildBwrapArgs('/tmp/workspace-root')).toMatchSnapshot()
})

test('exports timeout and kill-grace constants', () => {
  expect(BWRAP_TIMEOUT_SECONDS).toBe(30)
  expect(KILL_GRACE_SECONDS).toBe(5)
})

test('always includes required security flags', () => {
  const args = buildBwrapArgs('/tmp/workspace')

  expect(args).toContain('--unshare-all')
  expect(args).toContain('--share-net')
  expect(args).toContain('--die-with-parent')
  expect(args).toContain('--new-session')
})

test('can isolate networking and drop capabilities for hardened worker mode', () => {
  const args = buildBwrapArgs('/tmp/workspace', { network: 'isolated', dropAllCapabilities: true })

  expect(args).toContain('--unshare-all')
  expect(args).not.toContain('--share-net')
  expect(findTupleIndex(args, ['--cap-drop', 'ALL'])).toBeGreaterThanOrEqual(0)
})

test('docker profile avoids the user namespace and retains explicit isolation', () => {
  const args = buildBwrapArgs('/tmp/workspace', { namespaceProfile: 'docker' })

  expect(args).not.toContain('--unshare-all')
  expect(args.slice(0, 4)).toEqual([
    '--unshare-ipc',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-cgroup',
  ])
  expect(args).not.toContain('--unshare-user')
  expect(args).not.toContain('--unshare-net')
  expect(args).not.toContain('--share-net')
})

test('rejects unsupported namespace profiles at runtime', () => {
  expect(() => buildBwrapArgs('/tmp/workspace', {
    namespaceProfile: 'typo' as 'docker',
  })).toThrow('unsupported bwrap namespace profile: typo')
})

test('rejects unsupported network modes at runtime', () => {
  expect(() => buildBwrapArgs('/tmp/workspace', {
    namespaceProfile: 'docker',
    network: 'isoltaed' as 'isolated',
  })).toThrow('unsupported bwrap network mode: isoltaed')
})

test('docker profile always drops capabilities even when explicitly disabled', () => {
  const args = buildBwrapArgs('/tmp/workspace', {
    namespaceProfile: 'docker',
    dropAllCapabilities: false,
  })

  expect(findTupleIndex(args, ['--cap-drop', 'ALL'])).toBeGreaterThanOrEqual(0)
})

test('docker profile isolates networking only when requested', () => {
  const args = buildBwrapArgs('/tmp/workspace', {
    namespaceProfile: 'docker',
    network: 'isolated',
  })

  expect(args).toContain('--unshare-net')
  expect(args).not.toContain('--share-net')
  expect(findTupleIndex(args, ['--cap-drop', 'ALL'])).toBeGreaterThanOrEqual(0)
})

test.each([
  ['extraArgs', '--cap-add'],
  ['extraArgs', '--share-net'],
  ['extraArgs', '--unshare-user'],
  ['extraArgs', '--args'],
  ['postWorkspaceArgs', '--cap-add=ALL'],
  ['postWorkspaceArgs', '--unshare-all'],
] as const)('docker profile rejects raw policy counter-option in %s: %s', (source, flag) => {
  expect(() => buildBwrapArgs('/tmp/workspace', {
    namespaceProfile: 'docker',
    [source]: [flag],
  })).toThrow(`forbids ${flag.split('=', 1)[0]} in ${source}`)
})

test('docker profile still permits controlled raw mount arguments', () => {
  const args = buildBwrapArgs('/tmp/workspace', {
    namespaceProfile: 'docker',
    extraArgs: ['--dir', '/mnt'],
    postWorkspaceArgs: ['--ro-bind', '/tmp/source', '/workspace/source'],
  })

  expect(findTupleIndex(args, ['--dir', '/mnt'])).toBeGreaterThanOrEqual(0)
  expect(findTupleIndex(args, ['--ro-bind', '/tmp/source', '/workspace/source']))
    .toBeGreaterThanOrEqual(0)
})

test('binds workspace root exactly once and keeps it writable', () => {
  const workspaceRoot = '/tmp/workspace root/$(whoami)'
  const args = buildBwrapArgs(workspaceRoot)
  const bindIndex = findTupleIndex(args, ['--bind', workspaceRoot, '/workspace'])

  expect(bindIndex).toBeGreaterThanOrEqual(0)
  expect(args.filter((part) => part === '--bind')).toHaveLength(1)
  expect(args.filter((part, index) => (
    part === '--bind'
    && args[index + 1] === workspaceRoot
    && args[index + 2] === '/workspace'
  ))).toHaveLength(1)
})

test('includes read-only binds for every RO_BIND_DIRS entry', () => {
  const args = buildBwrapArgs('/tmp/workspace')

  for (const dir of RO_BIND_DIRS) {
    expect(findTupleIndex(args, ['--ro-bind', dir, dir])).toBeGreaterThanOrEqual(0)
  }
})

test('read-only binds appear before --chdir', () => {
  const args = buildBwrapArgs('/tmp/workspace')
  const chdirIndex = findTupleIndex(args, ['--chdir', '/workspace'])

  expect(chdirIndex).toBeGreaterThanOrEqual(0)
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--ro-bind') {
      expect(i).toBeLessThan(chdirIndex)
    }
  }
})

test('includes --chdir /workspace and --setenv HOME /workspace', () => {
  const args = buildBwrapArgs('/tmp/workspace')

  expect(findTupleIndex(args, ['--chdir', '/workspace'])).toBeGreaterThanOrEqual(0)
  expect(
    findTupleIndex(args, ['--setenv', 'HOME', '/workspace']),
  ).toBeGreaterThanOrEqual(0)
})

test('workspaceRoot with spaces is preserved as a single argument', () => {
  const workspaceRoot = '/home/user/my project'
  const args = buildBwrapArgs(workspaceRoot)
  const bindIndex = args.indexOf('--bind')

  expect(bindIndex).toBeGreaterThanOrEqual(0)
  expect(args[bindIndex + 1]).toBe(workspaceRoot)
})

test('workspaceRoot with shell metacharacters is treated literally', () => {
  const workspaceRoot = '/tmp/$(whoami)'
  const args = buildBwrapArgs(workspaceRoot)
  const bindIndex = args.indexOf('--bind')

  expect(bindIndex).toBeGreaterThanOrEqual(0)
  expect(args[bindIndex + 1]).toBe(workspaceRoot)
})

test('workspaceRoot with newline is rejected', () => {
  expect(() => buildBwrapArgs('/tmp/foo\nbar')).toThrow('newlines')
})

test('workspaceRoot with null byte is rejected', () => {
  expect(() => buildBwrapArgs('/tmp/foo\0bar')).toThrow('null bytes')
})

test('workspaceRoot does not require existence check', () => {
  const args = buildBwrapArgs('/tmp/definitely-not-existing-workspace-root')

  expect(findTupleIndex(args, ['--bind', '/tmp/definitely-not-existing-workspace-root', '/workspace']))
    .toBeGreaterThanOrEqual(0)
})

test('workspaceRoot is passed through as-is and not resolved', () => {
  const args = buildBwrapArgs('/tmp/workspace-link')

  expect(findTupleIndex(args, ['--bind', '/tmp/workspace-link', '/workspace']))
    .toBeGreaterThanOrEqual(0)
})

test('empty workspaceRoot is rejected', () => {
  expect(() => buildBwrapArgs('')).toThrow('must not be empty')
})

test('relative workspaceRoot is rejected', () => {
  expect(() => buildBwrapArgs('../workspace')).toThrow('absolute path')
})

test('absolute workspaceRoot with traversal segments is rejected', () => {
  expect(() => buildBwrapArgs('/tmp/workspace/../../etc')).toThrow('traversal segments')
})

test('very long workspaceRoot is rejected', () => {
  const veryLongPath = '/tmp/' + 'a'.repeat(4097)

  expect(() => buildBwrapArgs(veryLongPath)).toThrow('max path length')
})

test('--unshare-all is hardcoded and not derived from RO_BIND_DIRS', () => {
  expect(RO_BIND_DIRS).not.toContain('--unshare-all')
  expect(buildBwrapArgs('/tmp/workspace')).toContain('--unshare-all')
})

test('uses optional read-only binds only for resolver runtime dirs', () => {
  const args = buildBwrapArgs('/tmp/workspace')

  expect(args).not.toContain('--bind-try')
  for (const dir of RO_BIND_TRY_DIRS) {
    expect(findTupleIndex(args, ['--ro-bind-try', dir, dir])).toBeGreaterThanOrEqual(0)
  }
})

test('emits readonly binds for protected paths after the writable workspace bind', () => {
  const args = buildBwrapArgs('/tmp/workspace', { readonlyPaths: ['.agents'] })
  const workspaceBind = findTupleIndex(args, ['--bind', '/tmp/workspace', '/workspace'])
  const roBind = findTupleIndex(args, ['--ro-bind-try', '/tmp/workspace/.agents', '/workspace/.agents'])
  expect(workspaceBind).toBeGreaterThanOrEqual(0)
  expect(roBind).toBeGreaterThan(workspaceBind)
})

test('normalizes protected paths and rejects traversal', () => {
  expect(findTupleIndex(
    buildBwrapArgs('/tmp/workspace/', { readonlyPaths: ['./nested/dir/'] }),
    ['--ro-bind-try', '/tmp/workspace/nested/dir', '/workspace/nested/dir'],
  )).toBeGreaterThanOrEqual(0)
  expect(() => buildBwrapArgs('/tmp/workspace', { readonlyPaths: ['../escape'] })).toThrow('traversal')
  expect(() => buildBwrapArgs('/tmp/workspace', { readonlyPaths: ['/abs'] })).toThrow('workspace-relative')
})

import { describe, expect, test } from 'vitest'

import { buildBwrapArgs } from '../buildBwrapArgs'

describe('docker bwrap namespace profile', () => {
  test('uses explicit namespaces and mandatory capability dropping', () => {
    const args = buildBwrapArgs('/tmp/workspace', {
      namespaceProfile: 'docker',
      dropAllCapabilities: false,
    })

    expect(args).not.toContain('--unshare-all')
    expect(args.slice(0, 4)).toEqual([
      '--unshare-ipc',
      '--unshare-pid',
      '--unshare-uts',
      '--unshare-cgroup',
    ])
    expect(args).toContain('--cap-drop')
    expect(args).toContain('ALL')
  })

  test('rejects unsupported profiles at runtime', () => {
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

  test.each(['--cap-add', '--share-net', '--unshare-user', '--args'])(
    'rejects raw policy counter-option %s',
    (flag) => {
      expect(() => buildBwrapArgs('/tmp/workspace', {
        namespaceProfile: 'docker',
        extraArgs: [flag],
      })).toThrow(`forbids ${flag}`)
    },
  )

  test('preserves full profile as the default', () => {
    const args = buildBwrapArgs('/tmp/workspace')

    expect(args).toContain('--unshare-all')
    expect(args).toContain('--share-net')
    expect(args).not.toContain('--cap-drop')
  })
})

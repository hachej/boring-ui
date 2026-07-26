import { describe, expect, it } from 'vitest'

import { buildBwrapArgs } from '../buildBwrapArgs'

describe('buildBwrapArgs readonly workspace paths', () => {
  it('self-binds writable ancestors before the readonly leaf', () => {
    const args = buildBwrapArgs('/host/workspace', {
      readonlyWorkspacePaths: ['mixed/protected/deep'],
    })
    const tail = args.slice(args.indexOf('--bind', args.indexOf('--bind') + 1))
    expect(tail).toEqual(expect.arrayContaining([
      '--bind', '/host/workspace/mixed', '/workspace/mixed',
      '--bind', '/host/workspace/mixed/protected', '/workspace/mixed/protected',
      '--ro-bind', '/host/workspace/mixed/protected/deep', '/workspace/mixed/protected/deep',
    ]))
    expect(args.indexOf('/workspace/mixed')).toBeLessThan(args.indexOf('/workspace/mixed/protected/deep'))
  })

  it('collapses overlapping readonly roots without remounting an ancestor writable', () => {
    const args = buildBwrapArgs('/host/workspace', { readonlyWorkspacePaths: ['a', 'a/b'] })
    expect(args.filter((value) => value === '/workspace/a')).toHaveLength(1)
    expect(args).not.toContain('/workspace/a/b')
  })

  it.each(['', '/absolute', '../escape', 'a//b', 'a/./b', 'a/../b'])(
    'rejects invalid readonly path %j',
    (path) => {
      expect(() => buildBwrapArgs('/host/workspace', { readonlyWorkspacePaths: [path] })).toThrow(
        'readonlyWorkspacePaths must contain normalized workspace-relative paths',
      )
    },
  )
})

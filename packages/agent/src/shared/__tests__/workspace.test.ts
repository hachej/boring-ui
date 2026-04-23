import { expectTypeOf, test } from 'vitest'

import type { Entry, Stat, Workspace } from '../workspace'

test('Workspace contract', () => {
  expectTypeOf<Workspace>().toHaveProperty('root')
  expectTypeOf<Workspace>().toHaveProperty('readFile')
  expectTypeOf<Workspace>().toHaveProperty('writeFile')
  expectTypeOf<Workspace>().toHaveProperty('unlink')
  expectTypeOf<Workspace>().toHaveProperty('readdir')
  expectTypeOf<Workspace>().toHaveProperty('stat')
  expectTypeOf<Workspace>().toHaveProperty('mkdir')
  expectTypeOf<Workspace>().toHaveProperty('rename')

  expectTypeOf<Workspace['root']>().toEqualTypeOf<string>()
  expectTypeOf<Workspace['readFile']>().returns.toEqualTypeOf<Promise<string>>()
  expectTypeOf<Workspace['writeFile']>().parameters.toEqualTypeOf<
    [relPath: string, data: string]
  >()
  expectTypeOf<Workspace['unlink']>().parameters.toEqualTypeOf<[relPath: string]>()
  expectTypeOf<Workspace['readdir']>().returns.toEqualTypeOf<Promise<Entry[]>>()
  expectTypeOf<Workspace['stat']>().returns.toEqualTypeOf<Promise<Stat>>()
  expectTypeOf<Workspace['mkdir']>().parameters.toEqualTypeOf<
    [relPath: string, opts?: { recursive?: boolean }]
  >()
  expectTypeOf<Workspace['rename']>().parameters.toEqualTypeOf<
    [fromRelPath: string, toRelPath: string]
  >()
})

test('Entry contract', () => {
  expectTypeOf<Entry>().toHaveProperty('name')
  expectTypeOf<Entry>().toHaveProperty('kind')

  expectTypeOf<Entry['name']>().toEqualTypeOf<string>()
  expectTypeOf<Entry['kind']>().toEqualTypeOf<'file' | 'dir'>()
})

test('Stat contract', () => {
  expectTypeOf<Stat>().toHaveProperty('size')
  expectTypeOf<Stat>().toHaveProperty('mtimeMs')
  expectTypeOf<Stat>().toHaveProperty('kind')

  expectTypeOf<Stat['size']>().toEqualTypeOf<number>()
  expectTypeOf<Stat['mtimeMs']>().toEqualTypeOf<number>()
  expectTypeOf<Stat['kind']>().toEqualTypeOf<'file' | 'dir'>()
})

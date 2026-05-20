import { expectTypeOf, test } from 'vitest'
import type { WorkspaceRuntimeContext } from '../runtime'
import type { Workspace, Entry, Stat } from '../workspace'

test('checking Workspace contract', () => {
  expectTypeOf<Workspace>().toHaveProperty('root')
  expectTypeOf<Workspace>().toHaveProperty('runtimeContext')
  expectTypeOf<Workspace>().toHaveProperty('readFile')
  expectTypeOf<Workspace>().toHaveProperty('writeFile')
  expectTypeOf<Workspace>().toHaveProperty('unlink')
  expectTypeOf<Workspace>().toHaveProperty('readdir')
  expectTypeOf<Workspace>().toHaveProperty('stat')
  expectTypeOf<Workspace>().toHaveProperty('mkdir')
  expectTypeOf<Workspace>().toHaveProperty('rename')

  expectTypeOf<Workspace['root']>().toEqualTypeOf<string>()
  expectTypeOf<Workspace['runtimeContext']>().toEqualTypeOf<WorkspaceRuntimeContext>()
  expectTypeOf<Workspace['readFile']>().parameters.toEqualTypeOf<[string]>()
  expectTypeOf<Workspace['readFile']>().returns.toEqualTypeOf<Promise<string>>()
  expectTypeOf<Workspace['writeFile']>().parameters.toEqualTypeOf<[string, string]>()
  expectTypeOf<Workspace['rename']>().parameters.toEqualTypeOf<[string, string]>()
})

test('checking Entry contract', () => {
  expectTypeOf<Entry>().toHaveProperty('name')
  expectTypeOf<Entry>().toHaveProperty('kind')

  expectTypeOf<Entry['name']>().toEqualTypeOf<string>()
  expectTypeOf<Entry['kind']>().toEqualTypeOf<'file' | 'dir'>()
})

test('checking Stat contract', () => {
  expectTypeOf<Stat>().toHaveProperty('size')
  expectTypeOf<Stat>().toHaveProperty('mtimeMs')
  expectTypeOf<Stat>().toHaveProperty('kind')

  expectTypeOf<Stat['size']>().toEqualTypeOf<number>()
  expectTypeOf<Stat['mtimeMs']>().toEqualTypeOf<number>()
  expectTypeOf<Stat['kind']>().toEqualTypeOf<'file' | 'dir'>()
})

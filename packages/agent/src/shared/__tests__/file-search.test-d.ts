import { expectTypeOf, test } from 'vitest'
import type { FileSearch } from '../file-search'

test('checking FileSearch contract', () => {
  expectTypeOf<FileSearch>().toHaveProperty('search')
  expectTypeOf<FileSearch['search']>().toBeFunction()
  expectTypeOf<FileSearch['search']>().returns.toEqualTypeOf<Promise<string[]>>()
})

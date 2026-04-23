import { expectTypeOf, test } from 'vitest'

import type { FileSearch } from '../file-search'

test('FileSearch contract', () => {
  expectTypeOf<FileSearch>().toEqualTypeOf<{
    search: (glob: string, limit?: number) => Promise<string[]>
  }>()
})

import { describe, expect, it } from 'vitest'
import { toFileSearchGlob } from '../search'

const CASES: Array<[query: string, glob: string]> = [
  ['app', '*[Aa][Pp][Pp]*'],
  ['README', '*[Rr][Ee][Aa][Dd][Mm][Ee]*'],
  ['src/*.tsx', '[Ss][Rr][Cc]/*.[Tt][Ss][Xx]'],
]

describe('toFileSearchGlob', () => {
  it.each(CASES)('normalizes %s to %s', (query, glob) => {
    expect(toFileSearchGlob(query)).toBe(glob)
  })

  it('preserves workspace empty-query behavior', () => {
    expect(toFileSearchGlob('')).toBe('')
  })
})

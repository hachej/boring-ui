import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpProvider } from './httpProvider'

const mockBuildApiUrl = vi.fn()

vi.mock('../../utils/apiBase', () => ({
  buildApiUrl: (...args) => mockBuildApiUrl(...args),
}))

describe('httpProvider', () => {
  beforeEach(() => {
    mockBuildApiUrl.mockReset()
    mockBuildApiUrl.mockImplementation((path, query) => {
      if (!query) return `http://test${path}`
      return `http://test${path}?${new URLSearchParams(query).toString()}`
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ entries: [], content: '', oid: 'oid-123' }),
      headers: { get: () => 'application/json' },
    })))
  })

  it('includes credentials on read requests', async () => {
    const provider = createHttpProvider()

    await provider.files.list('.')

    expect(fetch).toHaveBeenCalledWith(
      'http://test/api/v1/files/list?path=.',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })

  it('includes credentials on mutation requests', async () => {
    const provider = createHttpProvider()

    await provider.files.write('hello.txt', 'hello world')

    expect(fetch).toHaveBeenCalledWith(
      'http://test/api/v1/files/write?path=hello.txt',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
      }),
    )
  })
})

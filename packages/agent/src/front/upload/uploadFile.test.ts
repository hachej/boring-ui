import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadFile } from './uploadFile'

class TestFileReader {
  result: string | ArrayBuffer | null = null
  error: DOMException | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(): void {
    this.result = 'data:text/plain;base64,aGVsbG8='
    this.onload?.()
  }
}

const originalFileReader = globalThis.FileReader
afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: originalFileReader })
})

function file(name = 'notes.txt'): File {
  return { name, type: 'text/plain' } as File
}

describe('uploadFile', () => {
  it('preserves the legacy asset request and markdown result', async () => {
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader })
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      path: 'assets/uploads/notes-unique.txt',
      markdownUrl: 'assets/uploads/notes-unique.txt',
    }), { status: 200 }))

    const result = await uploadFile(file(), { directory: 'assets/custom', fetch: fetch as typeof globalThis.fetch })
    const request = fetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    expect(request[0]).toBe('/api/v1/files/upload')
    expect(JSON.parse(String(request[1].body))).toEqual({
      filename: 'notes.txt',
      contentType: 'text/plain',
      contentBase64: 'aGVsbG8=',
      directory: 'assets/custom',
    })
    expect(result).toEqual({ url: 'assets/uploads/notes-unique.txt', path: 'assets/uploads/notes-unique.txt' })
  })

  it('forwards host authentication headers while preserving upload headers', async () => {
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader })
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: 'assets/uploads/notes.txt' }), { status: 200 }))

    await uploadFile(file(), {
      workspaceRequestId: 'ws-1',
      requestHeaders: {
        Authorization: 'Bearer test-token',
        'x-custom-scope': 'clinic',
        'content-type': 'text/plain',
        'X-Boring-Workspace-Id': 'stale-workspace',
      },
      fetch: fetch as typeof globalThis.fetch,
    })

    const request = fetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    const headers = new Headers(request[1].headers)
    expect(headers.get('authorization')).toBe('Bearer test-token')
    expect(headers.get('x-custom-scope')).toBe('clinic')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-boring-workspace-id')).toBe('ws-1')
  })

  it('returns a raw workspace URL when requested', async () => {
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader })
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: 'assets/uploads/notes.txt' }), { status: 200 }))
    const result = await uploadFile(file(), {
      apiBaseUrl: '/api',
      workspaceRequestId: 'ws-1',
      responseUrl: 'raw',
      fetch: fetch as typeof globalThis.fetch,
    })
    expect(result).toEqual({
      url: '/api/api/v1/files/raw?path=assets%2Fuploads%2Fnotes.txt&workspaceId=ws-1',
      path: 'assets/uploads/notes.txt',
    })
  })
})

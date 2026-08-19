import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadFile } from './uploadFile'

class TestFileReader {
  result: string | ArrayBuffer | null = null
  error: DOMException | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  abort(): void {
    this.onabort?.()
  }

  readAsDataURL(): void {
    this.result = 'data:text/plain;base64,aGVsbG8='
    this.onload?.()
  }
}

const originalFileReader = globalThis.FileReader

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    value: originalFileReader,
  })
})

function file(name = 'notes.txt'): File {
  return { name, type: 'text/plain' } as File
}

describe('uploadFile', () => {
  it('preserves the legacy request and markdown result by default', async () => {
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader })
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      path: 'assets/uploads/notes-unique.txt',
      markdownUrl: 'assets/uploads/notes-unique.txt',
    }), { status: 200 }))

    const result = await uploadFile(file(), { fetch: fetch as typeof globalThis.fetch })

    const request = fetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    expect(JSON.parse(String(request[1].body))).toEqual({
      filename: 'notes.txt',
      contentType: 'text/plain',
      contentBase64: 'aGVsbG8=',
    })
    expect(result).toEqual({
      url: 'assets/uploads/notes-unique.txt',
      path: 'assets/uploads/notes-unique.txt',
    })
  })

  it('sends exact-name destination and collision fields and returns skipped details', async () => {
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader })
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      path: 'src/notes.txt',
      markdownUrl: 'src/notes.txt',
      skipped: true,
      reason: 'exists',
    }), { status: 200 }))

    const result = await uploadFile(file(), {
      directory: 'src',
      preserveName: true,
      collision: 'skip',
      fetch: fetch as typeof globalThis.fetch,
    })

    const request = fetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    expect(JSON.parse(String(request[1].body))).toMatchObject({
      filename: 'notes.txt',
      directory: 'src',
      preserveName: true,
      collision: 'skip',
    })
    expect(result).toEqual({
      url: 'src/notes.txt',
      path: 'src/notes.txt',
      skipped: true,
      reason: 'exists',
    })
  })

  it('aborts file reading before issuing the request', async () => {
    class PendingFileReader extends TestFileReader {
      override readAsDataURL(): void {}
    }
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: PendingFileReader })
    const controller = new AbortController()
    const fetch = vi.fn()

    const pending = uploadFile(file(), { signal: controller.signal, fetch })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes the abort signal to fetch', async () => {
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader })
    const controller = new AbortController()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: 'notes.txt' }), { status: 200 }))

    await uploadFile(file(), { signal: controller.signal, fetch: fetch as typeof globalThis.fetch })

    const request = fetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    expect(request[1]).toMatchObject({ signal: controller.signal })
  })

  it('preserves new response fields when a raw URL is requested', async () => {
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader })
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      path: 'src/notes.txt',
      skipped: false,
    }), { status: 200 }))

    const result = await uploadFile(file(), {
      apiBaseUrl: '/api',
      workspaceRequestId: 'ws-1',
      responseUrl: 'raw',
      preserveName: true,
      collision: 'replace',
      fetch: fetch as typeof globalThis.fetch,
    })

    expect(result).toEqual({
      url: '/api/api/v1/files/raw?path=src%2Fnotes.txt&workspaceId=ws-1',
      path: 'src/notes.txt',
      skipped: false,
    })
  })
})

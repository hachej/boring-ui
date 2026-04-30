import { afterAll, afterEach, beforeEach, expect, vi } from 'vitest'

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response | undefined> | Response | undefined

const handlers: FetchHandler[] = []
let cleanupFn: (() => void) | null = null
const originalFetch = globalThis.fetch?.bind(globalThis)
let fetchStubbed = false
let uiHelpersLoaded = false

function isFrontTestFile(): boolean {
  return (expect.getState().testPath ?? '').includes('/src/front/')
}

async function ensureUiHelpersLoaded(): Promise<void> {
  if (uiHelpersLoaded) return
  uiHelpersLoaded = true

  try {
    const testingLibraryModule = '@testing-library/react'
    const testingLib = (await import(testingLibraryModule)) as {
      cleanup?: () => void
    }
    cleanupFn = testingLib.cleanup ?? null
  } catch {
    cleanupFn = null
  }
}

function ensureFetchStub(): void {
  if (fetchStubbed) return
  fetchStubbed = true
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    for (let index = handlers.length - 1; index >= 0; index -= 1) {
      const result = await handlers[index](input, init)
      if (result) return result
    }

    if (originalFetch) return originalFetch(input, init)

    throw new Error(
      'No mock handler matched this request. Register one with useMswHandler().',
    )
  })
}

export function useMswHandler(handler: FetchHandler): void {
  handlers.push(handler)
}

export function resetMswHandlers(): void {
  handlers.length = 0
}

beforeEach(async () => {
  if (!isFrontTestFile()) return
  vi.useRealTimers()
  await ensureUiHelpersLoaded()
  ensureFetchStub()
})

afterEach(() => {
  if (!isFrontTestFile()) return
  vi.useRealTimers()
  cleanupFn?.()
  resetMswHandlers()
})

afterAll(() => {
  if (!fetchStubbed) return
  vi.unstubAllGlobals()
})

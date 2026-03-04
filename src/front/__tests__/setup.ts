import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
})

// Minimal DOMMatrix polyfill for jsdom/test runtime.
// Some UI libraries (via pdf.js) reference DOMMatrix at module import time.
class MockDOMMatrix {
  a = 1
  b = 0
  c = 0
  d = 1
  e = 0
  f = 0
  m11 = 1
  m12 = 0
  m21 = 0
  m22 = 1
  m41 = 0
  m42 = 0
  is2D = true
  isIdentity = true

  constructor() {}

  multiplySelf() { return this }
  preMultiplySelf() { return this }
  translateSelf(x = 0, y = 0) { this.e += x; this.f += y; return this }
  scaleSelf() { return this }
  rotateSelf() { return this }
  invertSelf() { return this }
  toFloat64Array() { return new Float64Array([this.a, this.b, this.c, this.d, this.e, this.f]) }

  static fromMatrix() { return new MockDOMMatrix() }
}

vi.stubGlobal('DOMMatrix', MockDOMMatrix)

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
  writable: true,
})

// Mock EventSource for SSE
class MockEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  readyState = MockEventSource.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  url: string

  constructor(url: string) {
    this.url = url
    setTimeout(() => {
      this.readyState = MockEventSource.OPEN
      this.onopen?.(new Event('open'))
    }, 0)
  }

  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED
  })

  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  dispatchEvent = vi.fn()

  // Helper to simulate receiving a message
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }

  // Helper to simulate error
  simulateError() {
    this.onerror?.(new Event('error'))
  }
}

vi.stubGlobal('EventSource', MockEventSource)

// Mock fetch globally (individual tests can override)
vi.stubGlobal('fetch', vi.fn())

// Mock import.meta.env
vi.stubEnv('VITE_API_URL', '')

// Minimal indexedDB + IDBKeyRange stubs for modules that bootstrap lightning-fs
// during import/collection.
const createIndexedDbRequest = (result: unknown) => {
  const request: {
    result: unknown
    error: unknown
    onsuccess: ((event: { target: unknown }) => void) | null
    onerror: ((event: { target: unknown }) => void) | null
    onupgradeneeded: ((event: { target: unknown }) => void) | null
  } = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  }
  queueMicrotask(() => {
    request.onupgradeneeded?.({ target: request })
    request.onsuccess?.({ target: request })
  })
  return request
}

const indexedDbObjectStore = () => ({
  put: () => createIndexedDbRequest(undefined),
  get: () => createIndexedDbRequest(undefined),
  delete: () => createIndexedDbRequest(undefined),
  clear: () => createIndexedDbRequest(undefined),
  getAllKeys: () => createIndexedDbRequest([]),
  openCursor: () => createIndexedDbRequest(null),
  createIndex: () => ({}),
  index: () => ({}),
})

const indexedDbDatabase = () => ({
  createObjectStore: () => indexedDbObjectStore(),
  transaction: () => ({
    objectStore: () => indexedDbObjectStore(),
    oncomplete: null,
    onerror: null,
    onabort: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
  close: vi.fn(),
})

if (typeof globalThis.indexedDB === 'undefined') {
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => createIndexedDbRequest(indexedDbDatabase())),
    deleteDatabase: vi.fn(() => createIndexedDbRequest(undefined)),
  })
}

if (typeof globalThis.IDBKeyRange === 'undefined') {
  vi.stubGlobal('IDBKeyRange', {
    only: (value: unknown) => value,
    lowerBound: (value: unknown) => value,
    upperBound: (value: unknown) => value,
    bound: (left: unknown, right: unknown) => [left, right],
  })
}

// JSDOM defines getContext but throws "Not implemented". Replace with a harmless stub.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    canvas: { width: 300, height: 150 },
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: [] })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => []),
    createLinearGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    createPattern: vi.fn(() => null),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    transform: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  }))
}

// Suppress console errors during tests (optional - comment out for debugging)
// vi.spyOn(console, 'error').mockImplementation(() => {})

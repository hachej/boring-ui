import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { FetchClient, FetchError } from "../fetchClient"

let mockFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockFetch = vi.fn()
  vi.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function status(code: number) {
  return Promise.resolve(new Response(null, { status: code, statusText: `Error ${code}` }))
}

describe("FetchClient", () => {
  it("prepends apiBaseUrl to all requests", async () => {
    mockFetch.mockReturnValue(ok({ entries: [] }))
    const client = new FetchClient({ apiBaseUrl: "http://localhost:3000" })
    await client.getTree("/src")
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:3000/api/v1/tree"),
      expect.any(Object),
    )
  })

  it("strips trailing slash from apiBaseUrl", async () => {
    mockFetch.mockReturnValue(ok({ entries: [] }))
    const client = new FetchClient({ apiBaseUrl: "http://localhost:3000/" })
    await client.getTree("/src")
    expect(mockFetch.mock.calls[0][0]).not.toContain("3000//")
  })

  it("injects authHeaders into every request", async () => {
    mockFetch.mockReturnValue(ok({ content: "hi" }))
    const client = new FetchClient({
      apiBaseUrl: "",
      authHeaders: { Authorization: "Bearer tok" },
    })
    await client.getFile("/a.ts")
    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers.Authorization).toBe("Bearer tok")
  })

  it("GET /api/v1/tree uses ?path= and unwraps entries", async () => {
    const entries = [{ name: "a.ts", kind: "file" as const, path: "a.ts" }]
    mockFetch.mockReturnValue(ok({ entries }))
    const client = new FetchClient({ apiBaseUrl: "" })
    const result = await client.getTree(".")
    expect(result).toEqual(entries)
    expect(mockFetch.mock.calls[0][0]).toContain("?path=")
  })

  it("GET /api/v1/files returns { content }", async () => {
    mockFetch.mockReturnValue(ok({ content: "hello" }))
    const client = new FetchClient({ apiBaseUrl: "" })
    const result = await client.getFile("/a.ts")
    expect(result).toEqual({ content: "hello" })
  })

  it("POST /api/v1/files sends path and content", async () => {
    mockFetch.mockReturnValue(ok({ ok: true }))
    const client = new FetchClient({ apiBaseUrl: "" })
    await client.writeFile("/a.ts", "code")
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe("/api/v1/files")
    expect(opts.method).toBe("POST")
    expect(JSON.parse(opts.body)).toEqual({ path: "/a.ts", content: "code" })
  })

  it("DELETE /api/v1/files sends path param", async () => {
    mockFetch.mockReturnValue(ok({ ok: true }))
    const client = new FetchClient({ apiBaseUrl: "" })
    await client.deleteFile("/a.ts")
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain("/api/v1/files?path=")
    expect(opts.method).toBe("DELETE")
  })

  it("POST /api/v1/dirs creates directory", async () => {
    mockFetch.mockReturnValue(ok({ ok: true }))
    const client = new FetchClient({ apiBaseUrl: "" })
    await client.createDir("/src/new")
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toEqual({ path: "/src/new" })
  })

  it("POST /api/v1/files/move sends from and to", async () => {
    mockFetch.mockReturnValue(ok({ ok: true }))
    const client = new FetchClient({ apiBaseUrl: "" })
    await client.moveFile("/a.ts", "/b.ts")
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toEqual({ from: "/a.ts", to: "/b.ts" })
  })

  it("GET /api/v1/files/search sends query and limit", async () => {
    mockFetch.mockReturnValue(ok({ results: ["/a.ts"] }))
    const client = new FetchClient({ apiBaseUrl: "" })
    const result = await client.search("*.ts", 10)
    expect(result).toEqual(["/a.ts"])
    expect(mockFetch.mock.calls[0][0]).toContain("q=*.ts")
    expect(mockFetch.mock.calls[0][0]).toContain("limit=10")
  })

  it("GET /api/v1/stat returns { size, mtimeMs, kind }", async () => {
    mockFetch.mockReturnValue(ok({ size: 42, mtimeMs: 100, kind: "file" }))
    const client = new FetchClient({ apiBaseUrl: "" })
    const result = await client.stat("/a.ts")
    expect(result).toEqual({ size: 42, mtimeMs: 100, kind: "file" })
  })

  it("fires onAuthError on 401", async () => {
    mockFetch.mockReturnValue(status(401))
    const onAuthError = vi.fn()
    const client = new FetchClient({ apiBaseUrl: "", onAuthError })
    await expect(client.getTree("/")).rejects.toThrow()
    expect(onAuthError).toHaveBeenCalledWith(401)
  })

  it("fires onAuthError on 403", async () => {
    mockFetch.mockReturnValue(status(403))
    const onAuthError = vi.fn()
    const client = new FetchClient({ apiBaseUrl: "", onAuthError })
    await expect(client.getFile("/a")).rejects.toThrow()
    expect(onAuthError).toHaveBeenCalledWith(403)
  })

  it("throws FetchError with status on 404", async () => {
    mockFetch.mockReturnValue(status(404))
    const client = new FetchClient({ apiBaseUrl: "" })
    try {
      await client.getFile("/missing")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(FetchError)
      expect((e as FetchError).status).toBe(404)
    }
  })

  it("throws FetchError on 500 after exhausting retries", async () => {
    mockFetch.mockReturnValue(status(500))
    const client = new FetchClient({ apiBaseUrl: "", maxRetries: 0 })
    try {
      await client.getTree("/")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(FetchError)
      expect((e as FetchError).status).toBe(500)
    }
  })

  it("aborts on timeout", async () => {
    mockFetch.mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 50)
      }),
    )
    const client = new FetchClient({ apiBaseUrl: "", timeout: 1, maxRetries: 0 })
    await expect(client.getTree("/")).rejects.toThrow()
  })
})

describe("FetchClient — retry logic", () => {
  const retryOpts = { retryBaseMs: 1 }

  it("5xx response triggers automatic retry up to maxRetries", async () => {
    mockFetch.mockImplementation(() => status(500))
    const client = new FetchClient({ apiBaseUrl: "", maxRetries: 3, ...retryOpts })
    await expect(client.getTree("/")).rejects.toThrow()
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it("successful retry returns data without surfacing error", async () => {
    mockFetch
      .mockImplementationOnce(() => status(500))
      .mockImplementationOnce(() => status(503))
      .mockImplementationOnce(() => ok({ entries: [{ name: "a.ts", kind: "file", path: "a.ts" }] }))
    const client = new FetchClient({ apiBaseUrl: "", maxRetries: 3, ...retryOpts })
    const result = await client.getTree("/")
    expect(result).toEqual([{ name: "a.ts", kind: "file", path: "a.ts" }])
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it("all retries fail propagates last error", async () => {
    mockFetch.mockImplementation(() => status(502))
    const client = new FetchClient({ apiBaseUrl: "", maxRetries: 2, ...retryOpts })
    try {
      await client.getTree("/")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(FetchError)
      expect((e as FetchError).status).toBe(502)
    }
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it("4xx responses are NOT retried", async () => {
    mockFetch.mockImplementation(() => status(404))
    const client = new FetchClient({ apiBaseUrl: "", maxRetries: 3, ...retryOpts })
    await expect(client.getTree("/")).rejects.toThrow()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("network errors (TypeError) trigger retry", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementationOnce(() => ok({ entries: [] }))
    const client = new FetchClient({ apiBaseUrl: "", maxRetries: 3, ...retryOpts })
    const result = await client.getTree("/")
    expect(result).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("timeout triggers retry", async () => {
    mockFetch
      .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
      .mockImplementationOnce(() => ok({ entries: [] }))
    const client = new FetchClient({ apiBaseUrl: "", maxRetries: 3, timeout: 100, ...retryOpts })
    const result = await client.getTree("/")
    expect(result).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

describe("FetchClient — auth errors", () => {
  it("401 fires onAuthError and is not retried", async () => {
    mockFetch.mockImplementation(() => status(401))
    const onAuthError = vi.fn()
    const client = new FetchClient({ apiBaseUrl: "", onAuthError, maxRetries: 3, retryBaseMs: 1 })
    await expect(client.getTree("/")).rejects.toThrow()
    expect(onAuthError).toHaveBeenCalledWith(401)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("403 fires onAuthError and is not retried", async () => {
    mockFetch.mockImplementation(() => status(403))
    const onAuthError = vi.fn()
    const client = new FetchClient({ apiBaseUrl: "", onAuthError, maxRetries: 3, retryBaseMs: 1 })
    await expect(client.getFile("/a")).rejects.toThrow()
    expect(onAuthError).toHaveBeenCalledWith(403)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe("FetchClient — timeout", () => {
  it("onTimeout callback fires on timeout", async () => {
    mockFetch.mockRejectedValue(new DOMException("Aborted", "AbortError"))
    const onTimeout = vi.fn()
    const client = new FetchClient({ apiBaseUrl: "", timeout: 1, onTimeout, maxRetries: 0 })
    await expect(client.getTree("/")).rejects.toThrow()
    expect(onTimeout).toHaveBeenCalledWith(expect.stringContaining("/api/v1/tree"))
  })
})

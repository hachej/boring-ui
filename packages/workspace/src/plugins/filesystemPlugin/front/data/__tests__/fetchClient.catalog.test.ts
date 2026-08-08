import { afterEach, describe, expect, it, vi } from "vitest"
import { FetchClient } from "../fetchClient"

const capabilities = {
  read: true,
  list: true,
  search: true,
  write: false,
  delete: false,
  move: false,
  mkdir: false,
}

afterEach(() => vi.restoreAllMocks())

describe("FetchClient filesystem catalog", () => {
  it("loads generic roots with auth, credentials, capabilities, and abort signal", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      filesystems: [
        { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: { ...capabilities, write: true, delete: true, move: true, mkdir: true } },
        { filesystem: "project_alpha", label: "Project alpha", rootDir: "/docs", access: "readonly", capabilities },
      ],
    }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    const client = new FetchClient({ apiBaseUrl: "https://example.test", authHeaders: { Authorization: "Bearer token" } })

    await expect(client.getFilesystems(controller.signal)).resolves.toEqual(expect.arrayContaining([
      // Payloads predating gh-1123 omit `execute`; the parser defaults it off.
      expect.objectContaining({ filesystem: "project_alpha", access: "readonly", capabilities: { ...capabilities, execute: false } }),
    ]))
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/api/v1/filesystems",
      expect.objectContaining({ method: "GET", credentials: "include", signal: expect.any(AbortSignal), headers: { Authorization: "Bearer token" } }),
    )
  })

  it("discards malformed and duplicate entries without filesystem-specific inference", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      filesystems: [
        { filesystem: "generic", label: "First", rootDir: "/", access: "readwrite", capabilities },
        { filesystem: "generic", label: "Duplicate", rootDir: "/", access: "readonly", capabilities },
        { filesystem: "company_context", label: "Malformed", rootDir: "/", access: "readonly", capabilities: { read: true } },
        { filesystem: "bad\nidentity", label: "Bad", rootDir: "/", access: "readonly", capabilities },
      ],
    }), { status: 200 })))

    const result = await new FetchClient({ apiBaseUrl: "" }).getFilesystems()

    expect(result).toEqual([{ filesystem: "generic", label: "First", rootDir: "/", access: "readwrite", capabilities: { ...capabilities, execute: false } }])
  })
})

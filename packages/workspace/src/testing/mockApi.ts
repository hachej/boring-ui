import type { FileContent, FileEntry, FileStat } from "../data/types"

export interface MockFileFixture {
  path: string
  content: string
  mtimeMs?: number
}

export interface MockDataFixtures {
  files?: MockFileFixture[]
}

interface FileRecord {
  content: string
  mtimeMs: number
}

const DEFAULT_FILES: MockFileFixture[] = [
  {
    path: "src/main.ts",
    content: 'console.log("workspace testing fixture")\n',
  },
  {
    path: "README.md",
    content: "# Workspace Testing Fixtures\n",
  },
]

function normalizePath(path: string): string {
  const raw = path.trim()
  if (!raw || raw === ".") return "."
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "")
  return normalized || "."
}

function parentDir(path: string): string {
  const normalized = normalizePath(path)
  if (normalized === ".") return "."
  const index = normalized.lastIndexOf("/")
  return index <= 0 ? "." : normalized.slice(0, index)
}

function listEntries(
  rootPath: string,
  directories: Set<string>,
  files: Map<string, FileRecord>,
): FileEntry[] {
  const root = normalizePath(rootPath)
  const prefix = root === "." ? "" : `${root}/`
  const items = new Map<string, FileEntry>()

  for (const dir of directories) {
    if (dir === ".") continue
    if (!dir.startsWith(prefix)) continue
    const rest = dir.slice(prefix.length)
    if (!rest) continue
    const top = rest.split("/")[0]
    if (!top) continue
    const path = prefix ? `${prefix}${top}` : top
    items.set(top, { name: top, kind: "dir", path })
  }

  for (const path of files.keys()) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    if (!rest || rest.includes("/")) continue
    items.set(rest, { name: rest, kind: "file", path: prefix ? `${prefix}${rest}` : rest })
  }

  return [...items.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function ensureDirectories(path: string, directories: Set<string>): void {
  const normalized = normalizePath(path)
  if (normalized === ".") {
    directories.add(".")
    return
  }
  directories.add(".")
  const parts = normalized.split("/")
  let current = ""
  for (let i = 0; i < parts.length; i++) {
    current = current ? `${current}/${parts[i]}` : parts[i]
    directories.add(current)
  }
}

function parsePathParam(url: URL): string {
  return normalizePath(url.searchParams.get("path") ?? ".")
}

function parseSearchParams(url: URL): { query: string; limit: number } {
  const query = (url.searchParams.get("q") ?? "").toLowerCase()
  const parsedLimit = Number(url.searchParams.get("limit") ?? "20")
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.floor(parsedLimit)
    : 20
  return { query, limit }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function buildUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input, "http://workspace.testing")
  if (input instanceof URL) return new URL(input.toString())
  return new URL(input.url, "http://workspace.testing")
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  const fromInit = init?.body
  if (typeof fromInit === "string") {
    return JSON.parse(fromInit) as Record<string, unknown>
  }
  if (typeof input !== "string" && !(input instanceof URL) && input.body) {
    const text = await input.clone().text()
    if (text) return JSON.parse(text) as Record<string, unknown>
  }
  return {}
}

export function createMockApiFetch(
  fixtures: MockDataFixtures = {},
  fallbackFetch?: typeof fetch,
): typeof fetch {
  const files = new Map<string, FileRecord>()
  const directories = new Set<string>(["."])
  const now = Date.now()

  for (const fixture of fixtures.files ?? DEFAULT_FILES) {
    const path = normalizePath(fixture.path)
    files.set(path, { content: fixture.content, mtimeMs: fixture.mtimeMs ?? now })
    ensureDirectories(parentDir(path), directories)
  }

  const mockFetch: typeof fetch = async (input, init) => {
    const url = buildUrl(input)
    const method =
      (init?.method
        ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")
        ?? "GET").toUpperCase()
    const pathname = url.pathname

    if (!pathname.endsWith("/api/v1/tree")
      && !pathname.endsWith("/api/v1/files")
      && !pathname.endsWith("/api/v1/stat")
      && !pathname.endsWith("/api/v1/files/search")
      && !pathname.endsWith("/api/v1/dirs")
      && !pathname.endsWith("/api/v1/files/move")) {
      if (fallbackFetch) return fallbackFetch(input, init)
      return jsonResponse({ error: "not found" }, 404)
    }

    if (method === "GET" && pathname.endsWith("/api/v1/tree")) {
      const path = parsePathParam(url)
      if (path !== "." && !directories.has(path)) {
        return jsonResponse({ entries: [] as FileEntry[] })
      }
      return jsonResponse({ entries: listEntries(path, directories, files) })
    }

    if (method === "GET" && pathname.endsWith("/api/v1/files")) {
      const path = parsePathParam(url)
      const file = files.get(path)
      if (!file) return jsonResponse({ error: "not found" }, 404)
      return jsonResponse({ content: file.content } satisfies FileContent)
    }

    if (method === "POST" && pathname.endsWith("/api/v1/files")) {
      const body = await readBody(input, init)
      const path = normalizePath(String(body.path ?? "."))
      const content = String(body.content ?? "")
      files.set(path, { content, mtimeMs: Date.now() })
      ensureDirectories(parentDir(path), directories)
      return jsonResponse({ ok: true })
    }

    if (method === "DELETE" && pathname.endsWith("/api/v1/files")) {
      const path = parsePathParam(url)
      files.delete(path)
      return jsonResponse({ ok: true })
    }

    if (method === "GET" && pathname.endsWith("/api/v1/stat")) {
      const path = parsePathParam(url)
      if (files.has(path)) {
        const file = files.get(path)!
        return jsonResponse({
          size: file.content.length,
          mtimeMs: file.mtimeMs,
          kind: "file",
        } satisfies FileStat)
      }
      if (directories.has(path)) {
        return jsonResponse({
          size: 0,
          mtimeMs: Date.now(),
          kind: "dir",
        } satisfies FileStat)
      }
      return jsonResponse({ error: "not found" }, 404)
    }

    if (method === "GET" && pathname.endsWith("/api/v1/files/search")) {
      const { query, limit } = parseSearchParams(url)
      const results = [...files.keys()]
        .filter((path) => path.toLowerCase().includes(query))
        .slice(0, limit)
      return jsonResponse({ results })
    }

    if (method === "POST" && pathname.endsWith("/api/v1/dirs")) {
      const body = await readBody(input, init)
      const path = normalizePath(String(body.path ?? "."))
      ensureDirectories(path, directories)
      return jsonResponse({ ok: true })
    }

    if (method === "POST" && pathname.endsWith("/api/v1/files/move")) {
      const body = await readBody(input, init)
      const from = normalizePath(String(body.from ?? "."))
      const to = normalizePath(String(body.to ?? "."))
      const file = files.get(from)
      if (file) {
        files.delete(from)
        files.set(to, { content: file.content, mtimeMs: Date.now() })
        ensureDirectories(parentDir(to), directories)
        return jsonResponse({ ok: true })
      }
      if (directories.has(from)) {
        const nextFiles = new Map<string, FileRecord>()
        const fromPrefix = `${from}/`
        const toPrefix = `${to}/`
        for (const [path, record] of files.entries()) {
          if (path === from || path.startsWith(fromPrefix)) {
            const suffix = path === from ? "" : path.slice(fromPrefix.length)
            const movedPath = suffix ? `${toPrefix}${suffix}` : to
            nextFiles.set(movedPath, { ...record, mtimeMs: Date.now() })
          } else {
            nextFiles.set(path, record)
          }
        }
        files.clear()
        for (const [path, record] of nextFiles.entries()) files.set(path, record)
        ensureDirectories(to, directories)
        return jsonResponse({ ok: true })
      }
      return jsonResponse({ error: "not found" }, 404)
    }

    return jsonResponse({ error: "unsupported method" }, 405)
  }

  return mockFetch
}

import type { Plugin, ViteDevServer } from "vite"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, "fixtures")

interface VirtualFile {
  content: string
  kind: "file"
}

interface VirtualDir {
  kind: "dir"
  children: Map<string, VirtualFile | VirtualDir>
}

type VirtualNode = VirtualFile | VirtualDir

function loadFixtures(): VirtualDir {
  const root: VirtualDir = { kind: "dir", children: new Map() }

  const srcDir: VirtualDir = { kind: "dir", children: new Map() }
  root.children.set("src", srcDir)

  const entries = readdirSync(FIXTURES_DIR)
  for (const name of entries) {
    const content = readFileSync(join(FIXTURES_DIR, name), "utf-8")
    srcDir.children.set(name, { content, kind: "file" })
  }

  return root
}

function resolve(root: VirtualDir, path: string): VirtualNode | null {
  const parts = path.replace(/^\/+/, "").split("/").filter((p) => p && p !== ".")
  let node: VirtualNode = root
  for (const part of parts) {
    if (node.kind !== "dir") return null
    const child = node.children.get(part)
    if (!child) return null
    node = child
  }
  return node
}

function allPaths(node: VirtualDir, prefix: string): string[] {
  const result: string[] = []
  for (const [name, child] of node.children) {
    const p = prefix ? `${prefix}/${name}` : name
    result.push(p)
    if (child.kind === "dir") {
      result.push(...allPaths(child, p))
    }
  }
  return result
}

function ensureDir(root: VirtualDir, path: string): VirtualDir {
  const parts = path.replace(/^\/+/, "").split("/").filter((p) => p && p !== ".")
  let node: VirtualDir = root
  for (const part of parts) {
    let child = node.children.get(part)
    if (!child || child.kind !== "dir") {
      child = { kind: "dir", children: new Map() }
      node.children.set(part, child)
    }
    node = child
  }
  return node
}

function json(res: any, data: unknown, status = 200) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(data))
}

export function mockApiPlugin(): Plugin {
  let fs: VirtualDir

  return {
    name: "workspace-playground-mock-api",
    configureServer(server: ViteDevServer) {
      fs = loadFixtures()

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url!, `http://${req.headers.host}`)
        if (!url.pathname.startsWith("/api/v1/")) return next()

        const path = url.pathname

        if (path === "/api/v1/tree" && req.method === "GET") {
          const rawDir = url.searchParams.get("path") ?? ""
          const dirPath = rawDir.replace(/^\.?\/?/, "").replace(/\/+$/, "")
          const node = resolve(fs, dirPath)
          if (!node || node.kind !== "dir") {
            return json(res, { entries: [] })
          }
          const entries = [...node.children.entries()].map(([name, child]) => ({
            name,
            kind: child.kind,
            path: dirPath ? `${dirPath}/${name}` : name,
          }))
          return json(res, { entries })
        }

        if (path === "/api/v1/files" && req.method === "GET") {
          const filePath = url.searchParams.get("path") ?? ""
          const node = resolve(fs, filePath)
          if (!node || node.kind !== "file") {
            return json(res, { error: "not found" }, 404)
          }
          return json(res, { content: node.content })
        }

        if (path === "/api/v1/files" && req.method === "POST") {
          let body = ""
          req.on("data", (chunk: Buffer) => { body += chunk.toString() })
          req.on("end", () => {
            try {
              const { path: filePath, content } = JSON.parse(body)
              const parts = filePath.replace(/^\/+/, "").split("/")
              const fileName = parts.pop()!
              const parentPath = parts.join("/")
              const parent = parentPath ? ensureDir(fs, parentPath) : fs
              parent.children.set(fileName, { content, kind: "file" })
              json(res, { ok: true })
            } catch {
              json(res, { error: "bad request" }, 400)
            }
          })
          return
        }

        if (path === "/api/v1/files" && req.method === "DELETE") {
          const filePath = url.searchParams.get("path") ?? ""
          const parts = filePath.replace(/^\/+/, "").split("/")
          const fileName = parts.pop()!
          const parentPath = parts.join("/")
          const parent = parentPath ? resolve(fs, parentPath) : fs
          if (parent?.kind === "dir") {
            parent.children.delete(fileName)
          }
          return json(res, { ok: true })
        }

        if (path === "/api/v1/stat" && req.method === "GET") {
          const filePath = url.searchParams.get("path") ?? ""
          const node = resolve(fs, filePath)
          if (!node) return json(res, { error: "not found" }, 404)
          if (node.kind === "file") {
            return json(res, {
              size: node.content.length,
              mtimeMs: Date.now(),
              kind: "file",
            })
          }
          return json(res, { size: 0, mtimeMs: Date.now(), kind: "dir" })
        }

        if (path === "/api/v1/files/search" && req.method === "GET") {
          const q = (url.searchParams.get("q") ?? "").toLowerCase()
          const limit = parseInt(url.searchParams.get("limit") ?? "20", 10)
          const paths = allPaths(fs, "")
          const results = paths
            .filter((p) => p.toLowerCase().includes(q))
            .slice(0, limit)
          return json(res, { results })
        }

        if (path === "/api/v1/dirs" && req.method === "POST") {
          let body = ""
          req.on("data", (chunk: Buffer) => { body += chunk.toString() })
          req.on("end", () => {
            try {
              const { path: dirPath } = JSON.parse(body)
              ensureDir(fs, dirPath)
              json(res, { ok: true })
            } catch {
              json(res, { error: "bad request" }, 400)
            }
          })
          return
        }

        if (path === "/api/v1/files/move" && req.method === "POST") {
          let body = ""
          req.on("data", (chunk: Buffer) => { body += chunk.toString() })
          req.on("end", () => {
            try {
              const { from, to } = JSON.parse(body)
              const node = resolve(fs, from)
              if (!node) return json(res, { error: "not found" }, 404)

              const fromParts = from.replace(/^\/+/, "").split("/")
              const fromName = fromParts.pop()!
              const fromParentPath = fromParts.join("/")
              const fromParent = fromParentPath ? resolve(fs, fromParentPath) : fs
              if (fromParent?.kind === "dir") {
                fromParent.children.delete(fromName)
              }

              const toParts = to.replace(/^\/+/, "").split("/")
              const toName = toParts.pop()!
              const toParentPath = toParts.join("/")
              const toParent = toParentPath ? ensureDir(fs, toParentPath) : fs
              toParent.children.set(toName, node)

              json(res, { ok: true })
            } catch {
              json(res, { error: "bad request" }, 400)
            }
          })
          return
        }

        return json(res, { error: "not found" }, 404)
      })
    },
  }
}

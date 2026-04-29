import {
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react"
import type { Decorator } from "@storybook/react"
import { DataProvider } from "../src/front/data"
import type { FileEntry } from "../src/front/data/types"
import { WorkspaceProvider } from "../src/WorkspaceProvider"
import type { FileTreeNode } from "../src/plugins/filesystemPlugin/file-tree/FileTree"

const ROOT_TREE: Record<string, FileEntry[]> = {
  ".": [
    { name: "src", kind: "dir", path: "src" },
    { name: "docs", kind: "dir", path: "docs" },
    { name: "README.md", kind: "file", path: "README.md" },
    { name: "package.json", kind: "file", path: "package.json" },
  ],
  src: [
    { name: "main.ts", kind: "file", path: "src/main.ts" },
    { name: "app.tsx", kind: "file", path: "src/app.tsx" },
    { name: "components", kind: "dir", path: "src/components" },
  ],
  "src/components": [
    { name: "Button.tsx", kind: "file", path: "src/components/Button.tsx" },
  ],
  docs: [
    { name: "guide.md", kind: "file", path: "docs/guide.md" },
  ],
}

const FILE_CONTENTS: Record<string, string> = {
  "src/main.ts": `export function main() {\n  console.log("storybook mock")\n}\n`,
  "src/app.tsx": `export function App() {\n  return <div>Hello Storybook</div>\n}\n`,
  "src/components/Button.tsx": `export function Button() {\n  return <button>Click</button>\n}\n`,
  "docs/guide.md": `# Guide\n\n- Mocked markdown data\n- Works inside Storybook\n`,
  "README.md": `# Workspace Fixture\n\nThis is fixture content used in stories.\n`,
  "package.json": `{"name":"storybook-fixture","private":true}`,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function makeMockFetch(originalFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      "http://localhost",
    )
    const method =
      (init?.method
        ?? (typeof input === "object" && "method" in input ? input.method : undefined)
        ?? "GET")
        .toUpperCase()

    if (url.pathname === "/api/v1/tree" && method === "GET") {
      const path = url.searchParams.get("path") ?? "."
      return jsonResponse({ entries: ROOT_TREE[path] ?? [] })
    }

    if (url.pathname === "/api/v1/files" && method === "GET") {
      const path = url.searchParams.get("path") ?? ""
      const content = FILE_CONTENTS[path]
      if (content == null) {
        return jsonResponse({ error: "Not found" }, 404)
      }
      return jsonResponse({ content })
    }

    if (url.pathname === "/api/v1/files/search" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase()
      const limit = Number(url.searchParams.get("limit") ?? "50")
      const results = Object.keys(FILE_CONTENTS)
        .filter((path) => path.toLowerCase().includes(q))
        .slice(0, limit)
      return jsonResponse({ results })
    }

    if (url.pathname === "/api/v1/stat" && method === "GET") {
      const path = url.searchParams.get("path") ?? ""
      const content = FILE_CONTENTS[path]
      if (content == null) {
        return jsonResponse({ error: "Not found" }, 404)
      }
      return jsonResponse({
        size: content.length,
        mtimeMs: Date.now(),
        kind: "file",
      })
    }

    if (
      (url.pathname === "/api/v1/files" && (method === "POST" || method === "DELETE"))
      || (url.pathname === "/api/v1/files/move" && method === "POST")
      || (url.pathname === "/api/v1/dirs" && method === "POST")
    ) {
      return jsonResponse({})
    }

    return originalFetch(input, init)
  }
}

function MockWorkspaceApiProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const originalFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = makeMockFetch(originalFetch)
    setReady(true)
    return () => {
      globalThis.fetch = originalFetch
    }
  }, [])

  if (!ready) {
    return null
  }

  return <>{children}</>
}

export const withWorkspaceProviders: Decorator = (Story) => (
  <WorkspaceProvider persistenceEnabled={false}>
    <DataProvider apiBaseUrl="">
      <div className="h-[640px] w-full max-w-[1200px] overflow-hidden rounded-md border border-border">
        <Story />
      </div>
    </DataProvider>
  </WorkspaceProvider>
)

export const withMockWorkspaceApi: Decorator = (Story) => (
  <MockWorkspaceApiProvider>
    <Story />
  </MockWorkspaceApiProvider>
)

export function generateFileTreeNodes(count: number): FileTreeNode[] {
  const files: FileTreeNode[] = []
  for (let i = 0; i < count; i += 1) {
    files.push({
      name: `file-${String(i).padStart(4, "0")}.ts`,
      kind: "file",
      path: `src/file-${String(i).padStart(4, "0")}.ts`,
    })
  }

  return [
    {
      name: "src",
      kind: "dir",
      path: "src",
      children: files,
    },
  ]
}

import { useLayoutEffect, useMemo, useState, type ReactNode } from "react"
import type { Automation, AutomationRun } from "@hachej/boring-automation/shared"
import { AutomationClientProvider, AutomationPanel, type AutomationClient } from "@hachej/boring-automation/testing"
import { DataExplorer } from "@hachej/boring-data-explorer/front"
import { createMockSeriesAdapter } from "@hachej/boring-data-explorer/testing"
import {
  CodeEditor,
  DockviewShell,
  FileTree,
  FileTreePane,
  MarkdownEditor,
  WorkspaceFilesProvider,
  WorkspaceProvider,
  type FileTreeNode,
  type PanelConfig,
} from "@hachej/boring-workspace"

const RICH_MARKDOWN = `# Workspace Notes

## Checklist
- [x] Scaffold component fixtures
- [x] Add responsive checkpoints
- [ ] Review visual diffs

## Code Sample
\`\`\`ts
export function sum(a: number, b: number): number {
  return a + b
}
\`\`\`

## Quote
> Keep fixtures deterministic for visual testing.
`

const ROOT_TREE = {
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
} as const

const FILE_CONTENTS: Record<string, string> = {
  "src/main.ts": `export function main() {\n  console.log("component fixture")\n}\n`,
  "src/app.tsx": `export function App() {\n  return <div>Hello fixture</div>\n}\n`,
  "src/components/Button.tsx": `export function Button() {\n  return <button>Click</button>\n}\n`,
  "docs/guide.md": `# Guide\n\n- Mocked markdown data\n- Works inside the review fixture\n`,
  "README.md": `# Workspace Fixture\n\nThis is deterministic fixture content.\n`,
  "package.json": `{"name":"ui-review-fixture","private":true}`,
}

const panels: PanelConfig[] = [
  { id: "filetree", title: "Files", component: () => <PlaceholderPanel label="Locked sidebar group" />, source: "app" },
  { id: "editor", title: "Editor", component: () => <PlaceholderPanel label="Center group" />, source: "app" },
  { id: "agent", title: "Agent", component: () => <PlaceholderPanel label="Collapsible right group" />, source: "app" },
]

export function readUiReviewComponentFixture(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("ui-review-fixture")
}

export function UiReviewComponentFixture({ name }: { name: string }) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light")
    return () => {
      document.documentElement.classList.remove("dark")
      document.documentElement.removeAttribute("data-theme")
    }
  }, [dark])

  const content = renderFixture(name)
  const centered = name === "data-catalog"
  const automation = name === "automation-pane"
  return (
    <main
      className={centered
        ? "flex min-h-screen items-start justify-center bg-background p-8 text-foreground"
        : automation
          ? "min-h-screen bg-background text-foreground"
          : "min-h-screen bg-background p-4 text-foreground"}
      data-ui-review-fixture={name}
    >
      {content}
    </main>
  )
}

function renderFixture(name: string): ReactNode {
  switch (name) {
    case "file-tree":
      return <FileTree files={generateFileTreeNodes(100)} height={560} onSelect={() => {}} />
    case "code-editor":
      return (
        <CodeEditor
          className="h-[560px]"
          language="javascript"
          content={`function greet(name) {\n  return \`hello \${name}\`\n}\n\nconsole.log(greet("world"))\n`}
          onChange={() => {}}
        />
      )
    case "markdown-editor":
      return <MarkdownEditor className="h-[560px]" content={RICH_MARKDOWN} onChange={() => {}} />
    case "dock-group":
      return (
        <WorkspaceProvider panels={panels} persistenceEnabled={false}>
          <div className="h-[640px] w-full overflow-hidden rounded border border-border">
            <DockviewShell
              layout={{
                version: "2.0",
                groups: [
                  { id: "sidebar", position: "left", panel: "filetree", locked: true, constraints: { minWidth: 200, maxWidthViewportRatio: 0.5 } },
                  { id: "center", position: "center", panel: "editor", dynamic: true, placeholder: "editor", constraints: { minWidth: 300 } },
                  { id: "right", position: "right", panel: "agent", collapsible: true, collapsedWidth: 40, constraints: { minWidth: 250 } },
                ],
              }}
            />
          </div>
        </WorkspaceProvider>
      )
    case "file-tree-pane":
      return (
        <MockWorkspaceApiProvider>
          <WorkspaceProvider persistenceEnabled={false}>
            <WorkspaceFilesProvider apiBaseUrl="">
              <div className="h-[640px] w-full max-w-[1200px] overflow-hidden rounded-md border border-border">
                <FileTreePane rootDir="." />
              </div>
            </WorkspaceFilesProvider>
          </WorkspaceProvider>
        </MockWorkspaceApiProvider>
      )
    case "data-catalog":
      return <DataCatalogFixture />
    case "automation-pane":
      return <AutomationPaneFixture />
    default:
      return <div data-ui-review-fixture-error>Unknown component fixture: {name}</div>
  }
}

const AUTOMATIONS: Automation[] = [
  {
    id: "daily-digest",
    title: "Daily workspace digest",
    enabled: true,
    cron: "0 9 * * 1-5",
    timezone: "America/New_York",
    model: "openai:gpt-5.5",
    thinkingLevel: "medium",
    promptRef: ".pi/automation/prompts/daily-digest.md",
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-18T14:30:00.000Z",
  },
  {
    id: "release-check",
    title: "Release readiness check",
    enabled: false,
    cron: "30 16 * * 5",
    timezone: "UTC",
    model: "google:gemini-3.1-pro-preview",
    thinkingLevel: "high",
    promptRef: ".pi/automation/prompts/release-check.md",
    createdAt: "2026-07-02T09:00:00.000Z",
    updatedAt: "2026-07-17T18:15:00.000Z",
  },
]

const AUTOMATION_RUNS: AutomationRun[] = []

function AutomationPaneFixture() {
  const client = useMemo<AutomationClient>(() => ({
    listAutomations: async () => AUTOMATIONS,
    createAutomation: async (input) => ({ ...AUTOMATIONS[0]!, ...input, id: "created-automation" }),
    getAutomation: async (id) => AUTOMATIONS.find((automation) => automation.id === id) ?? AUTOMATIONS[0]!,
    updateAutomation: async (id, patch) => ({ ...(AUTOMATIONS.find((automation) => automation.id === id) ?? AUTOMATIONS[0]!), ...patch }),
    deleteAutomation: async () => {},
    getPrompt: async () => "# Review workspace activity\n\nSummarize material changes and blockers.",
    updatePrompt: async () => {},
    runNow: async (id) => ({
      id: "fixture-run",
      automationId: id,
      sessionId: "fixture-session",
      status: "succeeded",
      trigger: "manual",
      scheduledFor: null,
      startedAt: "2026-07-18T14:30:00.000Z",
      completedAt: "2026-07-18T14:31:00.000Z",
      durationMs: 60_000,
      inputTokens: 120,
      outputTokens: 40,
      totalTokens: 160,
      promptSnapshot: "# Review workspace activity",
      modelSnapshot: "openai:gpt-5.5",
      error: null,
      createdAt: "2026-07-18T14:30:00.000Z",
      updatedAt: "2026-07-18T14:31:00.000Z",
    }),
    listRuns: async () => AUTOMATION_RUNS,
  }), [])
  return (
    <MockWorkspaceApiProvider>
      <WorkspaceProvider persistenceEnabled={false}>
        <AutomationClientProvider value={client}>
          <div data-ui-review-automation-frame className="overflow-hidden bg-background" style={{ height: "100vh", width: "100%" }}>
            <AutomationPanel onClose={() => {}} />
          </div>
        </AutomationClientProvider>
      </WorkspaceProvider>
    </MockWorkspaceApiProvider>
  )
}

function DataCatalogFixture() {
  const adapter = useMemo(createMockSeriesAdapter, [])
  const frequencyLabels: Record<string, string> = {
    D: "Daily", W: "Weekly", M: "Monthly", Q: "Quarterly", SA: "Semiannual", A: "Annual",
  }
  return (
    <div className="h-[560px] w-[340px] border border-border bg-background">
      <DataExplorer
        adapter={adapter}
        groupBy="frequency"
        facets={[
          { key: "frequency", label: "Frequency", order: ["D", "W", "M", "Q", "SA", "A"], formatValue: (value) => frequencyLabels[value] ?? value },
          { key: "source", label: "Source", formatValue: (value) => value === "fred" ? "FRED" : value === "derived" ? "Derived" : value },
        ]}
        onActivate={() => {}}
        getDragPayload={(row) => ({ mimeType: "text/series-id", value: row.id })}
        searchPlaceholder="Search series…"
        pageSize={50}
      />
    </div>
  )
}

function PlaceholderPanel({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{label}</div>
}

function MockWorkspaceApiProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const originalFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = makeMockFetch(originalFetch)
    setReady(true)
    return () => { globalThis.fetch = originalFetch }
  }, [])
  return ready ? <>{children}</> : null
}

function makeMockFetch(originalFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost")
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : undefined) ?? "GET").toUpperCase()
    if (url.pathname === "/api/v1/agent/models" && method === "GET") {
      return jsonResponse({ models: [{ provider: "openai", id: "gpt-5.5", name: "GPT-5.5" }] })
    }
    if (url.pathname === "/api/v1/tree" && method === "GET") {
      const path = url.searchParams.get("path") ?? "."
      return jsonResponse({ entries: ROOT_TREE[path as keyof typeof ROOT_TREE] ?? [] })
    }
    if (url.pathname === "/api/v1/files" && method === "GET") {
      const content = FILE_CONTENTS[url.searchParams.get("path") ?? ""]
      return content === undefined ? jsonResponse({ error: "Not found" }, 404) : jsonResponse({ content })
    }
    if (url.pathname === "/api/v1/files/search" && method === "GET") {
      const query = (url.searchParams.get("q") ?? "").toLowerCase()
      const limit = Number(url.searchParams.get("limit") ?? "50")
      return jsonResponse({ results: Object.keys(FILE_CONTENTS).filter((path) => path.toLowerCase().includes(query)).slice(0, limit) })
    }
    if (url.pathname === "/api/v1/stat" && method === "GET") {
      const content = FILE_CONTENTS[url.searchParams.get("path") ?? ""]
      return content === undefined
        ? jsonResponse({ error: "Not found" }, 404)
        : jsonResponse({ size: content.length, mtimeMs: 0, kind: "file" })
    }
    if ((url.pathname === "/api/v1/files" && (method === "POST" || method === "DELETE"))
      || (url.pathname === "/api/v1/files/move" && method === "POST")
      || (url.pathname === "/api/v1/dirs" && method === "POST")) return jsonResponse({})
    return originalFetch(input, init)
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function generateFileTreeNodes(count: number): FileTreeNode[] {
  return [{
    name: "src",
    kind: "dir",
    path: "src",
    children: Array.from({ length: count }, (_, index) => ({
      name: `file-${String(index).padStart(4, "0")}.ts`,
      kind: "file" as const,
      path: `src/file-${String(index).padStart(4, "0")}.ts`,
    })),
  }]
}

import { ToolCallGroup, mergeShadcnToolRenderers } from '@hachej/boring-agent/front'
import type { UIMessage } from 'ai'

const renderers = mergeShadcnToolRenderers()

// Helpers to build mock tool parts that satisfy isToolUIPart()
type MockPart = UIMessage['parts'][number]

function mockTool(opts: {
  toolName: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}): MockPart {
  return {
    type: 'dynamic-tool',
    toolName: opts.toolName,
    toolCallId: `mock-${opts.toolName}-${Math.random().toString(36).slice(2)}`,
    state: opts.state,
    input: opts.input ?? {},
    output: opts.output,
    errorText: opts.errorText,
  } as unknown as MockPart
}

// ---- Mock data ----

const settledGroup = [
  mockTool({
    toolName: 'bash',
    state: 'output-available',
    input: { command: 'ls -la packages/', description: '' },
    output: { stdout: 'drwxr-xr-x  agent\ndrwxr-xr-x  ui\ndrwxr-xr-x  workspace\n' },
  }),
  mockTool({
    toolName: 'bash',
    state: 'output-available',
    input: { command: 'cat packages/agent/package.json | grep version', description: '' },
    output: { stdout: '  "version": "0.1.0"' },
  }),
  mockTool({
    toolName: 'read',
    state: 'output-available',
    input: { path: 'packages/agent/src/front/ChatPanel.tsx' },
    output: { text: '"use client"\n\nimport { useCallback } from "react"\n// ... 1493 lines' },
  }),
  mockTool({
    toolName: 'edit',
    state: 'output-available',
    input: {
      path: 'packages/agent/src/front/toolRenderers.tsx',
      oldString: "  <h4 className=\"font-medium text-muted-foreground text-xs uppercase tracking-wide\">\n    Parameters\n  </h4>",
      newString: '',
    },
    output: { text: 'OK' },
  }),
]

const errorGroup = [
  mockTool({
    toolName: 'bash',
    state: 'output-available',
    input: { command: 'pnpm build', description: '' },
    output: { stdout: 'Building...\n' },
  }),
  mockTool({
    toolName: 'bash',
    state: 'output-error',
    input: { command: 'pnpm test --coverage', description: '' },
    errorText: 'Error: Test suite failed\n  FAIL src/front/__tests__/ToolCard.test.tsx\n  ● renders bash tool correctly',
  }),
]

const runningGroup = [
  mockTool({
    toolName: 'bash',
    state: 'input-available',
    input: { command: 'pnpm --filter @hachej/boring-agent build', description: '' },
  }),
  mockTool({
    toolName: 'grep',
    state: 'input-streaming',
    input: { pattern: 'border-border', path: 'packages/agent/src' },
  }),
]

// Individual card examples for the grid
const singleBash = mockTool({
  toolName: 'bash',
  state: 'output-available',
  input: { command: 'find . -name "*.test.tsx" | head -5', description: '' },
  output: { stdout: './packages/agent/src/front/__tests__/DebugDrawer.test.tsx\n./packages/agent/src/front/__tests__/ChatPanel.test.tsx' },
})
const singleRead = mockTool({
  toolName: 'read',
  state: 'output-available',
  input: { path: 'packages/agent/package.json' },
  output: { text: '{\n  "name": "@hachej/boring-agent",\n  "version": "0.1.0",\n  "main": "dist/index.js"\n}' },
})
const singleEdit = mockTool({
  toolName: 'edit',
  state: 'output-available',
  input: {
    path: 'packages/agent/src/front/primitives/tool.tsx',
    oldString: '  "group not-prose my-3 w-full"',
    newString:  '  "group not-prose my-1.5 w-full"',
  },
  output: { text: 'OK' },
})
const singleGrep = mockTool({
  toolName: 'grep',
  state: 'output-available',
  input: { pattern: 'ToolCallGroup', path: 'packages/agent/src' },
  output: { text: 'packages/agent/src/front/ChatPanel.tsx:  import { ToolCallGroup } from ...\npackages/agent/src/front/primitives/tool-call-group.tsx: export const ToolCallGroup' },
})

function GroupDemo({ label, parts, defaultOpen }: { label: string; parts: MockPart[]; defaultOpen?: boolean }) {
  const entries = parts.map((part, i) => ({ part, key: `${i}` }))
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-widest text-muted-foreground/50">{label}</p>
      <ToolCallGroup tools={entries} mergedToolRenderers={renderers} />
    </div>
  )
}

function SingleCard({ part }: { part: MockPart }) {
  const tp = part as any
  const render = renderers[tp.toolName] ?? renderers.__fallback
  return <div className="min-w-0">{render(tp)}</div>
}

export function Showcase() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <div className="mx-auto max-w-2xl px-6 py-10 text-foreground">
        {/* header */}
        <div className="mb-8">
          <h1 className="text-lg font-semibold">Tool Call UX</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Static showcase — no agent needed</p>
        </div>

        {/* groups */}
        <section className="space-y-8">
          <div className="space-y-5">
            <h2 className="text-[12px] font-medium uppercase tracking-widest text-muted-foreground/60">Grouped tool calls</h2>

            <GroupDemo
              label="Settled — collapsed by default"
              parts={settledGroup}
            />

            <GroupDemo
              label="Running — auto-expanded + shimmer title"
              parts={runningGroup}
            />

            <GroupDemo
              label="Settled with error"
              parts={errorGroup}
            />
          </div>

          {/* individual cards */}
          <div className="space-y-5">
            <h2 className="text-[12px] font-medium uppercase tracking-widest text-muted-foreground/60">Individual cards</h2>
            <div className="grid gap-0">
              <SingleCard part={singleBash} />
              <SingleCard part={singleRead} />
              <SingleCard part={singleEdit} />
              <SingleCard part={singleGrep} />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

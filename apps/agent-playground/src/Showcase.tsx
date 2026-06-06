import {
  Message,
  MessageContent,
  MessageResponse,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  ToolCallGroup,
  mergeShadcnToolRenderers,
} from '@hachej/boring-agent/front'
import type { UIMessage } from 'ai'

const renderers = mergeShadcnToolRenderers()

// Helpers to build mock tool parts that satisfy isToolUIPart()
type MockPart = UIMessage['parts'][number]

function mockTool(opts: {
  toolName: string
  state: string
  id?: string
  input?: unknown
  output?: unknown
  errorText?: string
}): MockPart {
  return {
    type: 'dynamic-tool',
    toolName: opts.toolName,
    toolCallId: opts.id ?? `mock-${opts.toolName}-${opts.state}`,
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
    id: 'mock-bash-list',
    input: { command: 'ls -la packages/', description: '' },
    output: { stdout: 'drwxr-xr-x  agent\ndrwxr-xr-x  ui\ndrwxr-xr-x  workspace\n' },
  }),
  mockTool({
    toolName: 'bash',
    state: 'output-available',
    id: 'mock-bash-version',
    input: { command: 'cat packages/agent/package.json | grep version', description: '' },
    output: { stdout: '  "version": "0.1.0"' },
  }),
  mockTool({
    toolName: 'read',
    state: 'output-available',
    id: 'mock-read-chat-panel',
    input: { path: 'packages/agent/src/front/ChatPanel.tsx' },
    output: { text: '"use client"\n\nimport { useCallback } from "react"\n// ... 1493 lines' },
  }),
  mockTool({
    toolName: 'edit',
    state: 'output-available',
    id: 'mock-edit-renderers',
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
    id: 'mock-bash-build',
    input: { command: 'pnpm build', description: '' },
    output: { stdout: 'Building...\n' },
  }),
  mockTool({
    toolName: 'bash',
    state: 'output-error',
    id: 'mock-bash-test-error',
    input: { command: 'pnpm test --coverage', description: '' },
    errorText: 'Error: Test suite failed\n  FAIL src/front/__tests__/ToolCard.test.tsx\n  ● renders bash tool correctly',
  }),
]

const runningGroup = [
  mockTool({
    toolName: 'bash',
    state: 'input-available',
    id: 'mock-bash-running-build',
    input: { command: 'pnpm --filter @hachej/boring-agent build', description: '' },
  }),
  mockTool({
    toolName: 'grep',
    state: 'input-streaming',
    id: 'mock-grep-streaming',
    input: { pattern: 'border-border', path: 'packages/agent/src' },
  }),
]

const abortedGroup = [
  mockTool({
    toolName: 'bash',
    state: 'aborted',
    id: 'mock-bash-aborted',
    input: { command: 'sleep 60', description: '' },
  }),
]

// Individual card examples for the grid
const singleBash = mockTool({
  toolName: 'bash',
  state: 'output-available',
  id: 'mock-single-bash',
  input: { command: 'find . -name "*.test.tsx" | head -5', description: '' },
  output: { stdout: './packages/agent/src/front/__tests__/DebugDrawer.test.tsx\n./packages/agent/src/front/__tests__/ChatPanel.test.tsx' },
})
const singleRead = mockTool({
  toolName: 'read',
  state: 'output-available',
  id: 'mock-single-read',
  input: { path: 'packages/agent/package.json' },
  output: { text: '{\n  "name": "@hachej/boring-agent",\n  "version": "0.1.0",\n  "main": "dist/index.js"\n}' },
})
const singleEdit = mockTool({
  toolName: 'edit',
  state: 'output-available',
  id: 'mock-single-edit',
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
  id: 'mock-single-grep',
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

const showcaseSessions = [
  { id: 'all', title: 'All message parts', meta: 'system, user, assistant, files' },
  { id: 'tools', title: 'Tool states', meta: 'running, used, stopped, failed' },
  { id: 'queue', title: 'Queue and errors', meta: 'pending follow-up, notice' },
]

function ShowcaseMessageSession() {
  return (
    <section className="space-y-4" data-boring-agent-part="message-showcase">
      <div>
        <h2 className="text-[12px] font-medium uppercase tracking-widest text-muted-foreground/60">Hard-coded chat session</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Static transcript fixture for checking every message shape without an agent run.</p>
      </div>
      <div className="grid min-h-[620px] overflow-hidden rounded-xl border border-border/60 bg-[color:var(--surface-chat)] md:grid-cols-[220px_1fr]">
        <aside className="border-b border-border/60 bg-background/55 p-2 md:border-b-0 md:border-r">
          <div className="mb-2 px-2 text-[11px] font-medium text-muted-foreground/70">Sessions</div>
          <div className="space-y-1">
            {showcaseSessions.map((session) => (
              <div
                key={session.id}
                className="w-full rounded-lg px-2.5 py-2 text-left text-[12px] text-muted-foreground"
              >
                <span className="block truncate font-medium">{session.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground/65">{session.meta}</span>
              </div>
            ))}
          </div>
        </aside>

        <div className="min-w-0 overflow-y-auto px-5 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <Message from="system" data-boring-agent-message-id="showcase-system" data-boring-agent-message-status="done">
              <MessageContent className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-muted-foreground">
                <MessageResponse>Session loaded from the static playground fixture.</MessageResponse>
              </MessageContent>
            </Message>

            <Message from="user" data-boring-agent-message-id="showcase-user" data-boring-agent-message-status="done">
              <MessageContent>
                <MessageResponse>Can you inspect `README.md`, explain the issue, and update the fixture?</MessageResponse>
              </MessageContent>
            </Message>

            <Message from="assistant" data-boring-agent-message-id="showcase-assistant-streaming" data-boring-agent-message-status="streaming">
              <MessageContent>
                <Reasoning defaultOpen isStreaming>
                  <ReasoningTrigger />
                  <ReasoningContent>
                    I need to inspect the repo, keep the transcript ordered, then show the tool state while the command is still running.
                  </ReasoningContent>
                </Reasoning>
                <ToolCallGroup
                  tools={runningGroup.map((part, index) => ({ part, key: `running-${index}` }))}
                  mergedToolRenderers={renderers}
                />
              </MessageContent>
            </Message>

            <Message from="assistant" data-boring-agent-message-id="showcase-assistant-final" data-boring-agent-message-status="done">
              <MessageContent>
                <Reasoning defaultOpen={false} duration={7}>
                  <ReasoningTrigger />
                  <ReasoningContent>
                    The relevant styling belongs in the shared message primitive so inline filenames and fenced code blocks do not fight each other.
                  </ReasoningContent>
                </Reasoning>
                <ToolCallGroup
                  tools={settledGroup.slice(0, 2).map((part, index) => ({ part, key: `settled-${index}` }))}
                  mergedToolRenderers={renderers}
                />
                <MessageResponse>
                  Done. Inline filenames like `README.md` now render as quiet chips, and fenced blocks still use the code block primitive.

                  ```ts
                  const baseline = "stable message ordering"
                  ```
                </MessageResponse>
                <div data-boring-agent-part="message-file" className="mt-3 inline-flex max-w-full items-center gap-2 rounded-md border border-border/60 bg-background/65 px-2 py-1 text-[12px] text-muted-foreground">
                  <span className="font-mono text-foreground/85">docs/plans/pi-native-chat-quality-baseline.md</span>
                  <span>updated</span>
                </div>
              </MessageContent>
            </Message>

            <Message from="assistant" data-boring-agent-message-id="showcase-assistant-error" data-boring-agent-message-status="error">
              <MessageContent>
                <ToolCallGroup
                  tools={errorGroup.map((part, index) => ({ part, key: `error-${index}` }))}
                  mergedToolRenderers={renderers}
                />
                <div data-boring-agent-part="message-notice" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                  Tool failed with a scoped active-turn error. The composer should recover after the terminal error.
                </div>
              </MessageContent>
            </Message>

            <Message from="assistant" data-boring-agent-message-id="showcase-assistant-aborted" data-boring-agent-message-status="aborted">
              <MessageContent>
                <ToolCallGroup
                  tools={abortedGroup.map((part, index) => ({ part, key: `aborted-${index}` }))}
                  mergedToolRenderers={renderers}
                />
                <MessageResponse>
                  The active turn was stopped. The tool state stays stopped instead of being reported as a used command.
                </MessageResponse>
              </MessageContent>
            </Message>

            <div
              data-boring-agent-part="composer-queue-preview"
              className="ml-auto flex w-full max-w-3xl items-start justify-between gap-3 rounded-md border border-dashed border-border/70 bg-muted/35 px-3 py-2 text-xs text-foreground"
            >
              <div className="min-w-0 text-muted-foreground">
                <div className="font-medium text-foreground">1 queued follow-up</div>
                <div className="truncate" data-boring-agent-part="composer-queue-preview-text">
                  After you finish, run the browser baseline too.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Showcase() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <div className="mx-auto max-w-5xl px-6 py-10 text-foreground">
        {/* header */}
        <div className="mb-8">
          <h1 className="text-lg font-semibold">Chat UX Showcase</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Static showcase - no agent needed</p>
        </div>

        <section className="space-y-8">
          <ShowcaseMessageSession />

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
            <div className="grid gap-4">
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

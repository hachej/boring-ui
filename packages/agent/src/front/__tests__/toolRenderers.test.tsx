// @vitest-environment jsdom
/**
 * Unit tests for the shadcn-styled tool renderers — pinning the rendered
 * shape of the high-frequency tools (exec_ui in particular) so a future
 * primitive change can't silently produce an empty Tool card.
 *
 * Why this exists: the renderer relies on `<ToolInput input={part.input} />`
 * and `<ToolOutput output={part.output} />` to visualize the tool call.
 * If `part.input` is undefined, ToolInput is suppressed; if `part.output`
 * is also undefined, ToolOutput returns null — and the user sees only
 * the header. We pin the assertion that for a realistic exec_ui openFile
 * call the body shows both the input JSON (kind + params) and the
 * output JSON (seq, status).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, test, vi } from "vitest"
import { ErrorCode } from "../../shared/error-codes"
import { buildFilesystemAgentTools } from "@hachej/boring-bash/agent"
import { ArtifactOpenProvider } from "../ArtifactOpenContext"
import { shadcnDefaultToolRenderers } from "../toolRenderers"
import { Tool, ToolHeader, ToolOutput } from "../primitives/tool"
import type { ToolPart } from "../../front/toolRenderers"
import type { RuntimeBundle } from "../../server/runtime/mode"

function makePart(overrides: Partial<ToolPart> & { toolName: string }): ToolPart {
  return {
    type: `tool-${overrides.toolName}`,
    toolCallId: "call-1",
    state: "output-available",
    ...overrides,
  }
}

function mockBundle(provider: string): RuntimeBundle {
  const runtimeContext = { runtimeCwd: "/workspace" }
  return {
    runtimeContext,
    storageRoot: provider === "vercel-sandbox" ? undefined : runtimeContext.runtimeCwd,
    workspace: {
      root: runtimeContext.runtimeCwd,
      runtimeContext,
      readFile: async () => "",
      writeFile: async () => {},
      unlink: async () => {},
      readdir: async () => [],
      stat: async () => ({ size: 0, mtimeMs: 0, kind: "file" as const }),
      mkdir: async () => {},
      rename: async () => {},
    },
    sandbox: {
      id: `renderer-${provider}`,
      placement: provider === "vercel-sandbox" ? "remote" : "server",
      provider,
      capabilities: ["exec"],
      runtimeContext,
      exec: async () => ({
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        exitCode: 0,
        durationMs: 0,
        truncated: false,
      }),
    },
    fileSearch: { search: async () => [] },
    filesystem: provider === "vercel-sandbox" ? { kind: "remote-workspace" } : { kind: "host" },
  }
}

function filesystemToolNames(provider: string): string[] {
  return buildFilesystemAgentTools(mockBundle(provider)).map((tool) => tool.name)
}

describe("shadcn filesystem renderer coverage", () => {
  test.each(["direct", "bwrap", "vercel-sandbox"])(
    "default renderers cover every %s filesystem tool",
    (provider) => {
      const missing = filesystemToolNames(provider).filter((name) => !shadcnDefaultToolRenderers[name])
      expect(missing).toEqual([])
    },
  )
})

test("file tool headers preserve explicit filesystem when opened from transcript refs", async () => {
  const onOpenArtifact = vi.fn()
  const part = makePart({
    toolName: "read",
    input: { path: "/company/hr/policy.md", filesystem: "company_context" },
    output: { content: "policy" },
  })

  render(
    <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>
      {shadcnDefaultToolRenderers.read!(part)}
    </ArtifactOpenProvider>,
  )

  fireEvent.click(screen.getAllByRole("button", { name: /company\/hr\/policy\.md/ })[1]!)
  expect(onOpenArtifact).toHaveBeenCalledWith("/company/hr/policy.md", { filesystem: "company_context" })
})

describe("workspace readiness tool status", () => {
  test.each([
    ["read", "workspace-fs", "Files are still loading."],
    ["bash", "sandbox-exec", "Sandbox is still waking."],
    ["exec_ui", "ui-bridge", "Workspace UI is still connecting."],
  ])("renders friendly retryable status for %s/%s", (toolName, requirement, copy) => {
    const part = makePart({
      toolName,
      state: "output-error",
      output: {
        content: [{ type: "text", text: "raw provider status 503 should be hidden" }],
        details: { code: ErrorCode.enum.WORKSPACE_NOT_READY, retryable: true, requirement },
      },
      errorText: "raw provider status 503 should be hidden",
    })
    const renderer = shadcnDefaultToolRenderers[toolName] ?? shadcnDefaultToolRenderers.__fallback!
    const html = renderToStaticMarkup(<>{renderer(part)}</>)
    expect(html).toContain(copy)
    expect(html).not.toContain("raw provider status 503 should be hidden")
  })

  test("does not treat agent runtime readiness as workspace substrate readiness", () => {
    const part = makePart({
      toolName: "read",
      state: "output-error",
      output: {
        details: { code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY, retryable: true },
      },
      errorText: "Preparing agent",
    })
    const html = renderToStaticMarkup(<>{shadcnDefaultToolRenderers.read!(part)}</>)
    expect(html).not.toContain("Files are still loading.")
  })

  test("renders friendly retryable runtime readiness status", () => {
    const part = makePart({
      toolName: "bash",
      state: "output-error",
      output: {
        content: [{ type: "text", text: "bm: command not found" }],
        details: {
          code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
          retryable: true,
          requirement: "runtime:python",
          state: "preparing",
        },
      },
      errorText: "bm: command not found",
    })
    const html = renderToStaticMarkup(<>{shadcnDefaultToolRenderers.bash!(part)}</>)
    expect(html).toContain("Python runtime dependencies are still installing.")
    expect(html).toContain("This is retryable")
    expect(html).not.toContain("bm: command not found")
  })
})

describe("tool output formatting", () => {
  test("keeps failed command headers in bounded title, badge, and chevron lanes", () => {
    const html = renderToStaticMarkup(
      <Tool>
        <ToolHeader
          type="dynamic-tool"
          toolName="bash"
          state="output-error"
          title="bash · printf a-very-long-unbroken-token-that-should-not-push-the-error-badge-away"
        />
      </Tool>,
    )

    expect(html).toContain('data-boring-agent-part="tool-header"')
    expect(html).toContain('flex w-full min-w-0 items-center')
    expect(html).toContain('data-boring-agent-part="tool-title"')
    expect(html).toContain('min-w-0 flex-1 truncate text-sm font-medium')
    expect(html).toContain('data-slot="badge"')
    expect(html).toContain('data-boring-agent-part="tool-chevron"')
    expect(html).toContain("Error")
  })

  test("formats multiline failed command errors as preformatted text", () => {
    const html = renderToStaticMarkup(
      <ToolOutput output={undefined} errorText={'line one\nline two'} />,
    )

    expect(html).toContain("<pre")
    expect(html).toContain("whitespace-pre-wrap")
    expect(html).toContain("overflow-hidden")
    expect(html).toContain("font-mono")
    expect(html).toContain("line one\nline two")
    expect(html).not.toContain("<div></div>")
  })

  test("does not duplicate object output when an explicit tool error is present", () => {
    const html = renderToStaticMarkup(
      <ToolOutput output={{ content: 'line one', errorText: 'line one' }} errorText="line one" />,
    )

    expect(html).toContain("<pre")
    expect(html).toContain("line one")
    expect(html).not.toContain('"content"')
    expect(html).not.toContain('"errorText"')
  })
})

describe("shadcn exec_ui renderer", () => {
  test("renders kind as the action label and params as mono tokens", () => {
    const part = makePart({
      toolName: "exec_ui",
      input: { kind: "openFile", params: { path: "src/README.md" } },
      output: { seq: 1, status: "ok" },
    })
    const html = renderToStaticMarkup(<>{shadcnDefaultToolRenderers.exec_ui!(part)}</>)
    // Kind reads as the action verb (no "exec_ui ·" prefix — wrench/zap
    // icon already signals tool nature).
    expect(html).toContain("openFile")
    // Param value renders inside a mono pill.
    expect(html).toContain("src/README.md")
    expect(html).toContain("font-mono")
  })

  test("header summary surfaces the params (kind + path) without expanding", () => {
    // Tool body is collapsed by default (Radix omits children at SSR
    // when collapsed), so the title carries everything the user needs
    // at a glance: kind + params as compact JSON.
    const part = makePart({
      toolName: "exec_ui",
      input: { kind: "openFile", params: { path: "src/README.md" } },
      output: { seq: 1, status: "ok" },
    })
    const html = renderToStaticMarkup(<>{shadcnDefaultToolRenderers.exec_ui!(part)}</>)
    expect(html).toContain("openFile")
    expect(html).toContain("path")
    expect(html).toContain("src/README.md")
  })

  test("header carries 'Completed' status badge when output is available", () => {
    const part = makePart({
      toolName: "exec_ui",
      input: { kind: "openFile", params: { path: "src/README.md" } },
      output: { seq: 1, status: "ok" },
    })
    const html = renderToStaticMarkup(<>{shadcnDefaultToolRenderers.exec_ui!(part)}</>)
    expect(html).toContain("Completed")
  })

  test("body is collapsed by default (matches other tool renderers)", () => {
    const part = makePart({
      toolName: "exec_ui",
      input: { kind: "openFile", params: { path: "src/README.md" } },
      output: { seq: 1, status: "ok" },
    })
    const html = renderToStaticMarkup(<>{shadcnDefaultToolRenderers.exec_ui!(part)}</>)
    expect(html).toContain('data-state="closed"')
  })

  test("error state shows 'Error' badge in the header (collapsed)", () => {
    // The detailed error text lives inside the collapsed body via
    // ToolOutput; only the badge is visible when collapsed. The badge
    // is enough to flag the failed call at a glance — the user expands
    // for the full message.
    const part = makePart({
      toolName: "exec_ui",
      state: "output-error",
      input: { kind: "openFile", params: { path: "missing.md" } },
      errorText: 'file not found at "missing.md" — try find',
    })
    const html = renderToStaticMarkup(<>{shadcnDefaultToolRenderers.exec_ui!(part)}</>)
    expect(html).toContain("Error")
    // Path the agent tried still surfaces in the header summary.
    expect(html).toContain("missing.md")
  })

  test("works for an unknown future kind without per-kind branching", () => {
    const part = makePart({
      toolName: "exec_ui",
      input: { kind: "openSplit", params: { path: "foo.ts", orientation: "horizontal" } },
      output: { seq: 2, status: "ok" },
    })
    const html = renderToStaticMarkup(<>{shadcnDefaultToolRenderers.exec_ui!(part)}</>)
    // Kind shows as the action label.
    expect(html).toContain("openSplit")
    // We surface VALUES (not keys), each in its own mono pill — keeps
    // the header tight and is generic across any params shape.
    expect(html).toContain("foo.ts")
    expect(html).toContain("horizontal")
  })

  test("input-streaming state (partial input, no output yet) still renders header", () => {
    const part = makePart({
      toolName: "exec_ui",
      state: "input-streaming",
      // During streaming the input may be partially populated or undefined.
      // We must not crash — the header should still render with a
      // placeholder kind and a "Pending" status badge.
    })
    const html = renderToStaticMarkup(<>{shadcnDefaultToolRenderers.exec_ui!(part)}</>)
    expect(html).toContain("(empty)")
    expect(html).toContain("Pending")
  })
})

describe("write tool renderer copy action", () => {
  const originalExecCommand = document.execCommand

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    document.execCommand = originalExecCommand
  })

  test("falls back to legacy copy when clipboard API is unavailable", async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand
    const part = makePart({
      toolName: "write",
      input: { path: "src/example.ts", content: "export const ok = true" },
    })

    render(<>{shadcnDefaultToolRenderers.write!(part)}</>)

    fireEvent.click(screen.getByRole("button", { name: /writesrc\/example\.tsCompleted/ }))
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith("copy")
    })
  })
})

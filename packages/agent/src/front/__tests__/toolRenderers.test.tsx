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
import { describe, test, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ErrorCode } from "../../shared/error-codes"
import { shadcnDefaultToolRenderers } from "../toolRenderers"
import type { ToolPart } from "../../front/toolRenderers"
import { buildFilesystemAgentTools } from "../../server/tools/filesystem"
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

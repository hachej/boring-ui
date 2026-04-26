import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { ToolPart } from "@boring/agent/ui-shadcn"
import { createWorkspaceToolRenderers } from "../workspaceToolRenderers"

function readPart(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "dynamic-tool",
    toolName: "read",
    toolCallId: "tc-1",
    state: "output-available",
    input: { path: "greeter.ts" },
    output: { text: "export const x = 1\n" },
    ...overrides,
  } as ToolPart
}

function writePart(): ToolPart {
  return {
    type: "dynamic-tool",
    toolName: "write",
    toolCallId: "tc-2",
    state: "output-available",
    input: { path: "src/utils.ts" },
    output: { written: 42 },
  } as ToolPart
}

function editPart(): ToolPart {
  return {
    type: "dynamic-tool",
    toolName: "edit",
    toolCallId: "tc-3",
    state: "output-available",
    input: { path: "src/main.ts", oldString: "a", newString: "b" },
    output: { replaced: 1 },
  } as ToolPart
}

describe("workspaceToolRenderers", () => {
  it("registers read / write / edit overrides and nothing else", () => {
    const renderers = createWorkspaceToolRenderers({})
    expect(Object.keys(renderers).sort()).toEqual(["edit", "read", "write"])
  })

  it("renders a read card with the file's basename in the header", () => {
    const renderers = createWorkspaceToolRenderers({})
    const node = renderers.read!(readPart({ input: { path: "deep/nested/sub/greeter.ts" } }))
    render(<>{node}</>)
    // basename only — keeps the chip readable in deep paths
    expect(screen.getByText("greeter.ts")).toBeInTheDocument()
    expect(screen.queryByText("deep/nested/sub/greeter.ts")).not.toBeInTheDocument()
  })

  it("read card filename is a clickable button when onOpenArtifact is supplied", () => {
    const onOpen = vi.fn()
    const renderers = createWorkspaceToolRenderers({ onOpenArtifact: onOpen })
    render(<>{renderers.read!(readPart())}</>)
    const button = screen.getByRole("button", { name: "greeter.ts" })
    expect(button).toHaveAttribute("title", "Open greeter.ts in workbench")
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledWith("greeter.ts")
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("write card click forwards the input path (basename in label, full path in title)", () => {
    const onOpen = vi.fn()
    const renderers = createWorkspaceToolRenderers({ onOpenArtifact: onOpen })
    render(<>{renderers.write!(writePart())}</>)
    const button = screen.getByRole("button", { name: "utils.ts" })
    expect(button).toHaveAttribute("title", "Open src/utils.ts in workbench")
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledWith("src/utils.ts")
  })

  it("edit card click forwards the input path", () => {
    const onOpen = vi.fn()
    const renderers = createWorkspaceToolRenderers({ onOpenArtifact: onOpen })
    render(<>{renderers.edit!(editPart())}</>)
    fireEvent.click(screen.getByRole("button", { name: "main.ts" }))
    expect(onOpen).toHaveBeenCalledWith("src/main.ts")
  })

  it("disables the button (no click handler, no pointer cursor) when onOpenArtifact is omitted", () => {
    const renderers = createWorkspaceToolRenderers({}) // no callback
    render(<>{renderers.read!(readPart())}</>)
    const button = screen.getByRole("button", { name: "greeter.ts" })
    expect(button).toBeDisabled()
    fireEvent.click(button) // should be a no-op
    // A disabled button with no onClick should produce no observable effect — pin
    // by asserting we can still query for the button itself afterwards (sanity).
    expect(button).toBeInTheDocument()
  })

  it("shows the running state dot on input-available state", () => {
    const renderers = createWorkspaceToolRenderers({})
    const { container } = render(
      <>{renderers.read!(readPart({ state: "input-available", output: undefined }))}</>,
    )
    // The status dot is the first <span aria-hidden="true"> with bg-amber + animate-pulse
    const dot = container.querySelector("span[aria-hidden='true']")
    expect(dot?.className).toMatch(/bg-amber-500/)
    expect(dot?.className).toMatch(/animate-pulse/)
  })

  it("shows the error state dot + label on output-error state", () => {
    const renderers = createWorkspaceToolRenderers({})
    render(<>{renderers.write!({ ...writePart(), state: "output-error" } as ToolPart)}</>)
    expect(screen.getByText("Error")).toBeInTheDocument()
  })

  it("read card shows line count preview when output text is present", () => {
    const renderers = createWorkspaceToolRenderers({})
    render(
      <>{renderers.read!(readPart({ output: { text: "a\nb\nc\n" } }))}</>,
    )
    // 3 newlines → 4 lines (split('\n').length on "a\nb\nc\n" returns 4)
    expect(screen.getByText(/4 lines/)).toBeInTheDocument()
  })

  it("write card shows byte-count preview", () => {
    const renderers = createWorkspaceToolRenderers({})
    render(<>{renderers.write!(writePart())}</>)
    expect(screen.getByText(/wrote 42 bytes/)).toBeInTheDocument()
  })

  it("edit card shows replacement-count preview (singular)", () => {
    const renderers = createWorkspaceToolRenderers({})
    render(<>{renderers.edit!(editPart())}</>)
    expect(screen.getByText(/1 replacement$/)).toBeInTheDocument()
  })
})
